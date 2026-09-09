package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

const testProxmoxAuthHeader = "PVEAPIToken=vaulta@pve!disks=test-secret"

// diskStubOptions configures buildDiskMux's fake Proxmox endpoints.
type diskStubOptions struct {
	listBody    []byte
	smartByDisk map[string][]byte // devpath -> raw "data" payload (no envelope)
	smartFail   map[string]bool   // devpath -> respond 500 instead
	listCalls   *int32
}

// buildDiskMux serves fake nodes/pve2/disks/{list,smart} endpoints matching
// the real Proxmox API shape (data wrapped in {"data": ...}), checking the
// Authorization header on every request.
func buildDiskMux(opts diskStubOptions) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/api2/json/nodes/pve2/disks/list", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != testProxmoxAuthHeader {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if opts.listCalls != nil {
			atomic.AddInt32(opts.listCalls, 1)
		}
		writeEnvelope(w, opts.listBody)
	})
	mux.HandleFunc("/api2/json/nodes/pve2/disks/smart", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != testProxmoxAuthHeader {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		disk := r.URL.Query().Get("disk")
		if opts.smartFail[disk] {
			http.Error(w, "smart failed", http.StatusInternalServerError)
			return
		}
		body, ok := opts.smartByDisk[disk]
		if !ok {
			http.NotFound(w, r)
			return
		}
		writeEnvelope(w, body)
	})
	return mux
}

func writeEnvelope(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"data":`))
	w.Write(data)
	w.Write([]byte(`}`))
}

func readTestdata(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// proxmoxConfigJSON builds a proxmox.json body for tests. labelsJSON, if
// empty, defaults to an empty object.
func proxmoxConfigJSON(url, caFile, labelsJSON string) string {
	if labelsJSON == "" {
		labelsJSON = "{}"
	}
	return fmt.Sprintf(`{"url":%q,"node":"pve2","tokenId":"vaulta@pve!disks","secret":"test-secret","caFile":%q,"labels":%s}`,
		url, caFile, labelsJSON)
}

// newDiskTestServer builds an apiServer wired to a fake FileBrowser (admin
// as given) and, when proxmoxJSON is non-empty, a proxmox.json file holding
// exactly that content (so a deliberately malformed string can be tested
// too).
func newDiskTestServer(t *testing.T, admin bool, proxmoxJSON string) *apiServer {
	t.Helper()
	fileBrowser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "auth=valid" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		user := fileBrowserUser{ID: 2, Username: "login-handle"}
		user.Permissions.Admin = admin
		writeJSON(w, http.StatusOK, user)
	}))
	t.Cleanup(fileBrowser.Close)

	cfg := newTestAPIServerConfig(t)
	cfg.FileBrowserURL = fileBrowser.URL
	cfg.Client = fileBrowser.Client()
	if proxmoxJSON != "" {
		path := filepath.Join(t.TempDir(), "proxmox.json")
		if err := os.WriteFile(path, []byte(proxmoxJSON), 0o600); err != nil {
			t.Fatal(err)
		}
		cfg.ProxmoxConfigPath = path
	}
	server, err := newAPIServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func decodeDiskStatusResponse(t *testing.T, recorder *httptest.ResponseRecorder) diskStatusResponse {
	t.Helper()
	var result diskStatusResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode disk status response: %v, body = %s", err, recorder.Body.String())
	}
	return result
}

func findDisk(t *testing.T, disks []diskStatus, devpath string) diskStatus {
	t.Helper()
	for _, disk := range disks {
		if disk.Devpath == devpath {
			return disk
		}
	}
	t.Fatalf("no disk with devpath %q in %#v", devpath, disks)
	return diskStatus{}
}

func mustInt64(t *testing.T, name string, v *int64) int64 {
	t.Helper()
	if v == nil {
		t.Fatalf("%s: expected a value, got null", name)
	}
	return *v
}

func mustNull(t *testing.T, name string, v *int64) {
	t.Helper()
	if v != nil {
		t.Fatalf("%s: expected null, got %d", name, *v)
	}
}

// TestSystemDisksNormalizesRealSamples exercises the full handler against
// the real captured testdata for both an HDD (ATA attributes) and an NVMe
// (free-form text) disk in one list. Note: the design spec's illustrative
// JSON shows sda temperatureC=44/powerOnHours=5823, but those numbers don't
// match the actual testdata fixture (id 194 raw is "45 (...)", id 9 raw is
// "5824 (...)") — this test asserts what the real fixture parses to.
func TestSystemDisksNormalizesRealSamples(t *testing.T) {
	listBody := readTestdata(t, "pve-disks-list.json")
	sdaBody := readTestdata(t, "pve-smart-sda.json")
	nvmeBody := readTestdata(t, "pve-smart-nvme0n1.json")

	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody: listBody,
		smartByDisk: map[string][]byte{
			"/dev/sda":     sdaBody,
			"/dev/nvme0n1": nvmeBody,
		},
	}))
	t.Cleanup(stub.Close)

	// Label only sda, so the nvme case proves the model fallback.
	labels := `{"/dev/sda":"NAS data (tank)"}`
	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", labels))

	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	response := decodeDiskStatusResponse(t, w)
	if response.Node != "pve2" {
		t.Fatalf("node = %q", response.Node)
	}
	if len(response.Disks) != 2 {
		t.Fatalf("expected 2 disks, got %d: %#v", len(response.Disks), response.Disks)
	}

	sda := findDisk(t, response.Disks, "/dev/sda")
	if sda.Label != "NAS data (tank)" {
		t.Fatalf("sda label = %q", sda.Label)
	}
	if sda.Model != "ST2000LM007-1R8174" || sda.Serial != "WDZQLV5G" {
		t.Fatalf("sda model/serial = %q/%q", sda.Model, sda.Serial)
	}
	if sda.SizeBytes != 2000398934016 {
		t.Fatalf("sda sizeBytes = %d", sda.SizeBytes)
	}
	if sda.Type != "hdd" || sda.UsedBy != "ZFS" {
		t.Fatalf("sda type/usedBy = %q/%q", sda.Type, sda.UsedBy)
	}
	if sda.Health != "PASSED" {
		t.Fatalf("sda health = %q", sda.Health)
	}
	if got := mustInt64(t, "sda temperatureC", sda.TemperatureC); got != 45 {
		t.Fatalf("sda temperatureC = %d, want 45", got)
	}
	if got := mustInt64(t, "sda powerOnHours", sda.PowerOnHours); got != 5824 {
		t.Fatalf("sda powerOnHours = %d, want 5824", got)
	}
	if got := mustInt64(t, "sda reallocatedSectors", sda.ReallocatedSectors); got != 0 {
		t.Fatalf("sda reallocatedSectors = %d, want 0", got)
	}
	if got := mustInt64(t, "sda pendingSectors", sda.PendingSectors); got != 0 {
		t.Fatalf("sda pendingSectors = %d, want 0", got)
	}
	mustNull(t, "sda wearPercent", sda.WearPercent)
	mustNull(t, "sda mediaErrors", sda.MediaErrors)
	if sda.Error != "" {
		t.Fatalf("sda error = %q", sda.Error)
	}

	nvme := findDisk(t, response.Disks, "/dev/nvme0n1")
	if nvme.Label != "WDC PC SN730 SDBPNTY-512G-1032" {
		t.Fatalf("nvme label (model fallback) = %q", nvme.Label)
	}
	if nvme.Type != "nvme" {
		t.Fatalf("nvme type = %q", nvme.Type)
	}
	if nvme.Health != "PASSED" {
		t.Fatalf("nvme health = %q", nvme.Health)
	}
	if got := mustInt64(t, "nvme temperatureC", nvme.TemperatureC); got != 49 {
		t.Fatalf("nvme temperatureC = %d, want 49", got)
	}
	if got := mustInt64(t, "nvme powerOnHours", nvme.PowerOnHours); got != 7249 {
		t.Fatalf("nvme powerOnHours = %d, want 7249", got)
	}
	if got := mustInt64(t, "nvme wearPercent", nvme.WearPercent); got != 4 {
		t.Fatalf("nvme wearPercent = %d, want 4", got)
	}
	if got := mustInt64(t, "nvme mediaErrors", nvme.MediaErrors); got != 0 {
		t.Fatalf("nvme mediaErrors = %d, want 0", got)
	}
	mustNull(t, "nvme reallocatedSectors", nvme.ReallocatedSectors)
	mustNull(t, "nvme pendingSectors", nvme.PendingSectors)
}

func TestSystemDisksFailedHealthMaps(t *testing.T) {
	listBody := []byte(`[{"devpath":"/dev/sda","model":"M","serial":"S","size":1,"type":"hdd","used":"ZFS","health":"PASSED","wearout":"N/A"}]`)
	smartBody := []byte(`{"health":"FAILED","type":"ata","attributes":[{"id":"194","raw":"50"}]}`)
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody:    listBody,
		smartByDisk: map[string][]byte{"/dev/sda": smartBody},
	}))
	t.Cleanup(stub.Close)

	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	response := decodeDiskStatusResponse(t, w)
	sda := findDisk(t, response.Disks, "/dev/sda")
	if sda.Health != "FAILED" {
		t.Fatalf("health = %q, want FAILED", sda.Health)
	}
}

func TestSystemDisksUnrecognizedHealthMapsToUnknown(t *testing.T) {
	listBody := []byte(`[{"devpath":"/dev/sda","model":"M","serial":"S","size":1,"type":"hdd","used":"ZFS","health":"PASSED","wearout":"N/A"}]`)
	smartBody := []byte(`{"health":"SOMETHING-WEIRD","type":"ata","attributes":[]}`)
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody:    listBody,
		smartByDisk: map[string][]byte{"/dev/sda": smartBody},
	}))
	t.Cleanup(stub.Close)

	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	response := decodeDiskStatusResponse(t, w)
	sda := findDisk(t, response.Disks, "/dev/sda")
	if sda.Health != "UNKNOWN" {
		t.Fatalf("health = %q, want UNKNOWN", sda.Health)
	}
}

func TestSystemDisksMissingAttributesYieldNull(t *testing.T) {
	listBody := []byte(`[{"devpath":"/dev/sda","model":"M","serial":"S","size":1,"type":"hdd","used":"ZFS","health":"PASSED","wearout":"N/A"}]`)
	// No id 194/190/9/5/197 present at all.
	smartBody := []byte(`{"health":"PASSED","type":"ata","attributes":[{"id":"  1","raw":"12345"}]}`)
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody:    listBody,
		smartByDisk: map[string][]byte{"/dev/sda": smartBody},
	}))
	t.Cleanup(stub.Close)

	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	response := decodeDiskStatusResponse(t, w)
	sda := findDisk(t, response.Disks, "/dev/sda")
	mustNull(t, "temperatureC", sda.TemperatureC)
	mustNull(t, "powerOnHours", sda.PowerOnHours)
	mustNull(t, "reallocatedSectors", sda.ReallocatedSectors)
	mustNull(t, "pendingSectors", sda.PendingSectors)
	mustNull(t, "wearPercent", sda.WearPercent)
	if sda.Health != "PASSED" {
		t.Fatalf("health = %q, want PASSED", sda.Health)
	}
}

func TestSystemDisksATATemperatureFallsBackTo190(t *testing.T) {
	listBody := []byte(`[{"devpath":"/dev/sda","model":"M","serial":"S","size":1,"type":"hdd","used":"ZFS","health":"PASSED","wearout":"N/A"}]`)
	// Only 190 present (no 194) - must be used, and it must differ from
	// what 194 would have given, so this actually proves fallback and not
	// coincidence.
	smartBody := []byte(`{"health":"PASSED","type":"ata","attributes":[{"id":"190","raw":"38 (Min/Max 30/40)"}]}`)
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody:    listBody,
		smartByDisk: map[string][]byte{"/dev/sda": smartBody},
	}))
	t.Cleanup(stub.Close)

	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	sda := findDisk(t, decodeDiskStatusResponse(t, w).Disks, "/dev/sda")
	if got := mustInt64(t, "temperatureC", sda.TemperatureC); got != 38 {
		t.Fatalf("temperatureC = %d, want 38 (from fallback attribute 190)", got)
	}
}

func TestSystemDisksATAPrefers194Over190WhenBothPresent(t *testing.T) {
	listBody := []byte(`[{"devpath":"/dev/sda","model":"M","serial":"S","size":1,"type":"hdd","used":"ZFS","health":"PASSED","wearout":"N/A"}]`)
	smartBody := []byte(`{"health":"PASSED","type":"ata","attributes":[{"id":"190","raw":"38"},{"id":"194","raw":"41"}]}`)
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody:    listBody,
		smartByDisk: map[string][]byte{"/dev/sda": smartBody},
	}))
	t.Cleanup(stub.Close)

	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	sda := findDisk(t, decodeDiskStatusResponse(t, w).Disks, "/dev/sda")
	if got := mustInt64(t, "temperatureC", sda.TemperatureC); got != 41 {
		t.Fatalf("temperatureC = %d, want 41 (194 must win over 190)", got)
	}
}

func TestSystemDisksPerDiskSmartFailureIsIsolated(t *testing.T) {
	listBody := readTestdata(t, "pve-disks-list.json")
	nvmeBody := readTestdata(t, "pve-smart-nvme0n1.json")
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody: listBody,
		smartByDisk: map[string][]byte{
			"/dev/nvme0n1": nvmeBody,
		},
		smartFail: map[string]bool{"/dev/sda": true},
	}))
	t.Cleanup(stub.Close)

	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	response := decodeDiskStatusResponse(t, w)
	if len(response.Disks) != 2 {
		t.Fatalf("expected both disks present despite one SMART failure, got %d", len(response.Disks))
	}

	sda := findDisk(t, response.Disks, "/dev/sda")
	if sda.Health != "UNKNOWN" {
		t.Fatalf("sda health = %q, want UNKNOWN", sda.Health)
	}
	if sda.Error == "" {
		t.Fatal("expected sda.Error to be set")
	}
	// List-derived fields must stay intact even though SMART failed.
	if sda.Model != "ST2000LM007-1R8174" || sda.Devpath != "/dev/sda" {
		t.Fatalf("sda list fields lost: %#v", sda)
	}

	nvme := findDisk(t, response.Disks, "/dev/nvme0n1")
	if nvme.Health != "PASSED" {
		t.Fatalf("nvme health = %q, want PASSED (unaffected by sda's failure)", nvme.Health)
	}
	if nvme.Error != "" {
		t.Fatalf("nvme error = %q, want empty", nvme.Error)
	}
}

func TestSystemDisksNotConfiguredReturns503(t *testing.T) {
	server := newDiskTestServer(t, true, "")
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if w.Body.String() != `{"error":"Disk monitoring is not configured."}`+"\n" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestSystemDisksMalformedConfigReturns503(t *testing.T) {
	server := newDiskTestServer(t, true, "{not valid json")
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestSystemDisksConfigMissingRequiredFieldsReturns503(t *testing.T) {
	server := newDiskTestServer(t, true, "{}")
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestSystemDisksRequiresAdmin(t *testing.T) {
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{listBody: []byte(`[]`)}))
	t.Cleanup(stub.Close)
	server := newDiskTestServer(t, false, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestSystemDisksRequiresAuthentication(t *testing.T) {
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{listBody: []byte(`[]`)}))
	t.Cleanup(stub.Close)
	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", false)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestSystemDisksCacheHitThenRefreshBypass(t *testing.T) {
	var listCalls int32
	listBody := readTestdata(t, "pve-disks-list.json")
	sdaBody := readTestdata(t, "pve-smart-sda.json")
	nvmeBody := readTestdata(t, "pve-smart-nvme0n1.json")
	stub := httptest.NewServer(buildDiskMux(diskStubOptions{
		listBody: listBody,
		smartByDisk: map[string][]byte{
			"/dev/sda":     sdaBody,
			"/dev/nvme0n1": nvmeBody,
		},
		listCalls: &listCalls,
	}))
	t.Cleanup(stub.Close)

	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, "", ""))

	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	w = request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := atomic.LoadInt32(&listCalls); got != 1 {
		t.Fatalf("list calls after two plain requests = %d, want 1 (cache hit)", got)
	}

	w = request(t, server.handler(), http.MethodGet, "/system/disks?refresh=1", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := atomic.LoadInt32(&listCalls); got != 2 {
		t.Fatalf("list calls after refresh=1 = %d, want 2", got)
	}
}

// --- TLS: caFile trust must be real, hostname/IP-checked verification. ---

// generateTestCA creates a minimal self-signed CA certificate/key for TLS
// tests, returning the CA's PEM bytes alongside the parsed cert/key so a
// leaf can be signed by it.
func generateTestCA(t *testing.T) ([]byte, *x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test disk-status CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return pemBytes, cert, key
}

// generateTestLeaf signs a 127.0.0.1 server certificate with the given CA,
// for use as an httptest.Server's TLS certificate.
func generateTestLeaf(t *testing.T, caCert *x509.Certificate, caKey *rsa.PrivateKey) tls.Certificate {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, caCert, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	cert, err := tls.X509KeyPair(leafPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

func writeCAFile(t *testing.T, pemBytes []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(path, pemBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSystemDisksTLSTrustedCAIsAccepted(t *testing.T) {
	caPEM, caCert, caKey := generateTestCA(t)
	leaf := generateTestLeaf(t, caCert, caKey)

	listBody := readTestdata(t, "pve-disks-list.json")
	sdaBody := readTestdata(t, "pve-smart-sda.json")
	nvmeBody := readTestdata(t, "pve-smart-nvme0n1.json")
	mux := buildDiskMux(diskStubOptions{
		listBody: listBody,
		smartByDisk: map[string][]byte{
			"/dev/sda":     sdaBody,
			"/dev/nvme0n1": nvmeBody,
		},
	})

	stub := httptest.NewUnstartedServer(mux)
	stub.TLS = &tls.Config{Certificates: []tls.Certificate{leaf}}
	stub.StartTLS()
	t.Cleanup(stub.Close)

	caFile := writeCAFile(t, caPEM)
	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, caFile, ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestSystemDisksTLSUntrustedCAIsRejected(t *testing.T) {
	// A CA unrelated to the server's own (httptest-generated) certificate.
	unrelatedCAPEM, _, _ := generateTestCA(t)

	var listCalls int32
	stub := httptest.NewTLSServer(buildDiskMux(diskStubOptions{
		listBody:  []byte(`[]`),
		listCalls: &listCalls,
	}))
	t.Cleanup(stub.Close)

	caFile := writeCAFile(t, unrelatedCAPEM)
	server := newDiskTestServer(t, true, proxmoxConfigJSON(stub.URL, caFile, ""))
	w := request(t, server.handler(), http.MethodGet, "/system/disks", "", true)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if got := atomic.LoadInt32(&listCalls); got != 0 {
		t.Fatalf("list calls = %d, want 0 (TLS handshake should never have succeeded)", got)
	}
}
