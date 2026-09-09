package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const diskStatusCacheTTL = 60 * time.Second

// proxmoxConfig is the on-disk shape of <NASAPI_DATA_PATH>/proxmox.json. A
// missing file means the feature is not configured; a malformed one is
// logged and treated the same way (loadProxmoxConfig never returns an error
// to its caller for that reason).
type proxmoxConfig struct {
	URL     string            `json:"url"`
	Node    string            `json:"node"`
	TokenID string            `json:"tokenId"`
	Secret  string            `json:"secret"`
	CAFile  string            `json:"caFile"`
	Labels  map[string]string `json:"labels"`
}

func loadProxmoxConfig(path string) *proxmoxConfig {
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		log.Printf("read proxmox config: %v", err)
		return nil
	}
	var cfg proxmoxConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		log.Printf("decode proxmox config: %v", err)
		return nil
	}
	if cfg.URL == "" || cfg.Node == "" || cfg.TokenID == "" || cfg.Secret == "" {
		log.Printf("proxmox config missing required field(s) (url/node/tokenId/secret)")
		return nil
	}
	return &cfg
}

// newProxmoxHTTPClient builds the client used to talk to the Proxmox API.
// Verification is never disabled: with no caFile the system trust store is
// used; with a caFile its PEM becomes the sole RootCAs pool (hostname/IP
// checking still applies).
func newProxmoxHTTPClient(cfg *proxmoxConfig) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.CAFile != "" {
		pemBytes, err := os.ReadFile(cfg.CAFile)
		if err != nil {
			return nil, fmt.Errorf("read CA file: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pemBytes) {
			return nil, fmt.Errorf("no certificates found in %s", cfg.CAFile)
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: pool}
	}
	return &http.Client{Transport: transport}, nil
}

// proxmoxEnvelope unwraps the `{"data": ...}` wrapper every Proxmox API
// response carries.
type proxmoxEnvelope struct {
	Data json.RawMessage `json:"data"`
}

// proxmoxListEntry is one element of GET /nodes/<node>/disks/list. Wearout
// is a RawMessage because Proxmox reports it as a number ("96") for a disk
// that supports it and the string "N/A" otherwise; a fixed int type would
// fail to decode the whole list.
type proxmoxListEntry struct {
	Devpath string          `json:"devpath"`
	Model   string          `json:"model"`
	Serial  string          `json:"serial"`
	Size    int64           `json:"size"`
	Type    string          `json:"type"`
	Health  string          `json:"health"`
	Used    string          `json:"used"`
	Wearout json.RawMessage `json:"wearout"`
}

// parseWearoutRemaining reads the list entry's numeric "remaining life %",
// returning ok=false for the non-numeric "N/A" (or any other non-number).
func parseWearoutRemaining(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, false
	}
	return n, true
}

// proxmoxAttribute is one ATA SMART attribute row. IDs come back space
// padded (e.g. "  9"), so callers must trim before comparing.
type proxmoxAttribute struct {
	ID  string `json:"id"`
	Raw string `json:"raw"`
}

// proxmoxSmartResponse is GET /nodes/<node>/disks/smart?disk=<devpath>. Type
// is "ata" (attributes populated) for HDD/SSD or "text" (free-form text)
// for NVMe.
type proxmoxSmartResponse struct {
	Health     string             `json:"health"`
	Type       string             `json:"type"`
	Attributes []proxmoxAttribute `json:"attributes"`
	Text       string             `json:"text"`
}

// proxmoxClient is the minimal HTTP client for the two Proxmox disk
// endpoints this feature needs. baseURL/node are plain fields (not baked
// into a closure) so tests can point them at httptest servers.
type proxmoxClient struct {
	baseURL    string
	node       string
	tokenID    string
	secret     string
	httpClient *http.Client
}

func (c *proxmoxClient) authHeader() string {
	return "PVEAPIToken=" + c.tokenID + "=" + c.secret
}

func (c *proxmoxClient) getJSON(ctx context.Context, path string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", c.authHeader())
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("proxmox returned %s", response.Status)
	}
	var envelope proxmoxEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("decode proxmox response: %w", err)
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return fmt.Errorf("decode proxmox data: %w", err)
	}
	return nil
}

func (c *proxmoxClient) fetchDisksList(ctx context.Context) ([]proxmoxListEntry, error) {
	var entries []proxmoxListEntry
	if err := c.getJSON(ctx, "/api2/json/nodes/"+c.node+"/disks/list", &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func (c *proxmoxClient) fetchSmart(ctx context.Context, devpath string) (*proxmoxSmartResponse, error) {
	query := url.Values{"disk": {devpath}}
	var response proxmoxSmartResponse
	path := "/api2/json/nodes/" + c.node + "/disks/smart?" + query.Encode()
	if err := c.getJSON(ctx, path, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

// diskStatus is one entry of the /system/disks response. Numeric fields the
// source did not provide are nil (JSON null) rather than a guessed zero.
type diskStatus struct {
	Devpath            string `json:"devpath"`
	Label              string `json:"label"`
	Model              string `json:"model"`
	Serial             string `json:"serial"`
	SizeBytes          int64  `json:"sizeBytes"`
	Type               string `json:"type"`
	UsedBy             string `json:"usedBy"`
	Health             string `json:"health"`
	TemperatureC       *int64 `json:"temperatureC"`
	PowerOnHours       *int64 `json:"powerOnHours"`
	ReallocatedSectors *int64 `json:"reallocatedSectors"`
	PendingSectors     *int64 `json:"pendingSectors"`
	WearPercent        *int64 `json:"wearPercent"`
	MediaErrors        *int64 `json:"mediaErrors"`
	Error              string `json:"error,omitempty"`
}

type diskStatusResponse struct {
	CheckedAt time.Time    `json:"checkedAt"`
	Node      string       `json:"node"`
	Disks     []diskStatus `json:"disks"`
}

// leadingInt parses the leading run of ASCII digits in s (after trimming
// whitespace), e.g. "45 (0 20 0 0 0)" -> 45. ok is false when s has no
// leading digits at all.
func leadingInt(s string) (int64, bool) {
	s = strings.TrimSpace(s)
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 {
		return 0, false
	}
	n, err := strconv.ParseInt(s[:i], 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

func findATAAttribute(attributes []proxmoxAttribute, id string) (proxmoxAttribute, bool) {
	for _, attribute := range attributes {
		if strings.TrimSpace(attribute.ID) == id {
			return attribute, true
		}
	}
	return proxmoxAttribute{}, false
}

// ataLeadingIntAttr looks up an ATA attribute by (trimmed) id and returns
// the leading integer of its raw value, or nil if the attribute is absent
// or its raw value has no leading integer.
func ataLeadingIntAttr(attributes []proxmoxAttribute, id string) *int64 {
	attribute, ok := findATAAttribute(attributes, id)
	if !ok {
		return nil
	}
	value, ok := leadingInt(attribute.Raw)
	if !ok {
		return nil
	}
	return &value
}

var (
	nvmeTemperatureRe = regexp.MustCompile(`(?m)^Temperature:\s+(\d+)`)
	nvmePercentUsedRe = regexp.MustCompile(`(?m)^Percentage Used:\s+(\d+)%`)
	nvmePowerOnRe     = regexp.MustCompile(`(?m)^Power On Hours:\s+([\d,]+)`)
	nvmeMediaErrorsRe = regexp.MustCompile(`(?m)^Media and Data Integrity Errors:\s+([\d,]+)`)
)

func regexInt(re *regexp.Regexp, text string) *int64 {
	match := re.FindStringSubmatch(text)
	if match == nil {
		return nil
	}
	cleaned := strings.ReplaceAll(match[1], ",", "")
	n, err := strconv.ParseInt(cleaned, 10, 64)
	if err != nil {
		return nil
	}
	return &n
}

func normalizeHealth(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "PASSED":
		return "PASSED"
	case "FAILED":
		return "FAILED"
	default:
		return "UNKNOWN"
	}
}

// applyATA fills in the ATA/SMART-attribute derived fields (HDD and non-NVMe
// SSD): temperature (194, falling back to 190), power-on hours (9),
// reallocated sectors (5), pending sectors (197) — each the leading integer
// of the attribute's raw value. wearPercent only applies to SSDs, as
// 100-wearout from the list entry when wearout is numeric.
func applyATA(disk *diskStatus, smart *proxmoxSmartResponse, entry proxmoxListEntry) {
	disk.TemperatureC = ataLeadingIntAttr(smart.Attributes, "194")
	if disk.TemperatureC == nil {
		disk.TemperatureC = ataLeadingIntAttr(smart.Attributes, "190")
	}
	disk.PowerOnHours = ataLeadingIntAttr(smart.Attributes, "9")
	disk.ReallocatedSectors = ataLeadingIntAttr(smart.Attributes, "5")
	disk.PendingSectors = ataLeadingIntAttr(smart.Attributes, "197")
	if entry.Type == "ssd" {
		if remaining, ok := parseWearoutRemaining(entry.Wearout); ok {
			wear := 100 - remaining
			disk.WearPercent = &wear
		}
	}
}

// applyNVMeText fills in the fields parsed out of the NVMe SMART free-form
// text block: temperature, power-on hours, media errors, and wear (from
// "Percentage Used", falling back to 100-wearout from the list entry).
func applyNVMeText(disk *diskStatus, smart *proxmoxSmartResponse, entry proxmoxListEntry) {
	disk.TemperatureC = regexInt(nvmeTemperatureRe, smart.Text)
	disk.PowerOnHours = regexInt(nvmePowerOnRe, smart.Text)
	disk.MediaErrors = regexInt(nvmeMediaErrorsRe, smart.Text)
	if wear := regexInt(nvmePercentUsedRe, smart.Text); wear != nil {
		disk.WearPercent = wear
	} else if remaining, ok := parseWearoutRemaining(entry.Wearout); ok {
		wear := 100 - remaining
		disk.WearPercent = &wear
	}
}

// normalizeDisk turns one list entry plus its (possibly failed) SMART call
// into a diskStatus. A SMART failure never drops the disk from the
// response: it comes back with health UNKNOWN and an error string, while
// devpath/label/model/serial/size/type/usedBy — all from the list call —
// stay intact.
func normalizeDisk(entry proxmoxListEntry, smart *proxmoxSmartResponse, smartErr error, label string) diskStatus {
	disk := diskStatus{
		Devpath:   entry.Devpath,
		Label:     label,
		Model:     entry.Model,
		Serial:    entry.Serial,
		SizeBytes: entry.Size,
		Type:      entry.Type,
		UsedBy:    entry.Used,
	}
	if smartErr != nil {
		disk.Health = "UNKNOWN"
		disk.Error = smartErr.Error()
		return disk
	}
	disk.Health = normalizeHealth(smart.Health)
	switch smart.Type {
	case "ata":
		applyATA(&disk, smart, entry)
	case "text":
		applyNVMeText(&disk, smart, entry)
	}
	return disk
}

// diskMonitor owns the (possibly absent) Proxmox config/client and the 60s
// in-memory cache for the /system/disks handler.
type diskMonitor struct {
	config *proxmoxConfig
	client *http.Client

	mu        sync.Mutex
	cached    *diskStatusResponse
	fetchedAt time.Time
}

func newDiskMonitor(configPath string) *diskMonitor {
	config := loadProxmoxConfig(configPath)
	if config == nil {
		return &diskMonitor{}
	}
	client, err := newProxmoxHTTPClient(config)
	if err != nil {
		log.Printf("configure proxmox client: %v", err)
		return &diskMonitor{}
	}
	return &diskMonitor{config: config, client: client}
}

func (m *diskMonitor) configured() bool {
	return m.config != nil && m.client != nil
}

// getStatus returns the cached response when it is fresher than
// diskStatusCacheTTL and refresh is false; otherwise it fetches live and
// updates the cache. A failed fetch never overwrites (or is served from) a
// stale cache entry.
func (m *diskMonitor) getStatus(ctx context.Context, refresh bool) (*diskStatusResponse, error) {
	m.mu.Lock()
	if !refresh && m.cached != nil && time.Since(m.fetchedAt) < diskStatusCacheTTL {
		cached := m.cached
		m.mu.Unlock()
		return cached, nil
	}
	m.mu.Unlock()

	response, err := m.fetch(ctx)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.cached = response
	m.fetchedAt = time.Now()
	m.mu.Unlock()
	return response, nil
}

// fetch does the one list round-trip plus one SMART round-trip per disk,
// all bounded by a single 10s deadline.
func (m *diskMonitor) fetch(ctx context.Context) (*diskStatusResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	client := &proxmoxClient{
		baseURL:    strings.TrimRight(m.config.URL, "/"),
		node:       m.config.Node,
		tokenID:    m.config.TokenID,
		secret:     m.config.Secret,
		httpClient: m.client,
	}

	entries, err := client.fetchDisksList(ctx)
	if err != nil {
		return nil, fmt.Errorf("list disks: %w", err)
	}

	disks := make([]diskStatus, 0, len(entries))
	for _, entry := range entries {
		label := m.config.Labels[entry.Devpath]
		if label == "" {
			label = entry.Model
		}
		smart, smartErr := client.fetchSmart(ctx, entry.Devpath)
		disks = append(disks, normalizeDisk(entry, smart, smartErr, label))
	}

	return &diskStatusResponse{
		CheckedAt: time.Now().UTC(),
		Node:      m.config.Node,
		Disks:     disks,
	}, nil
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (s *apiServer) handleSystemDisks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}
	if !s.disks.configured() {
		writeJSONError(w, http.StatusServiceUnavailable, "Disk monitoring is not configured.")
		return
	}
	refresh := r.URL.Query().Get("refresh") == "1"
	response, err := s.disks.getStatus(r.Context(), refresh)
	if err != nil {
		log.Printf("fetch disk status: %v", err)
		writeJSONError(w, http.StatusBadGateway, "Could not reach Proxmox for disk status.")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
