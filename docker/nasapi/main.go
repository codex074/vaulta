package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxDisplayNameRunes = 64

type storageResponse struct {
	UsedBytes  uint64 `json:"usedBytes"`
	TotalBytes uint64 `json:"totalBytes"`
}

type configResponse struct {
	OnlyOfficeURL string `json:"onlyOfficeUrl"`
}

type userScope struct {
	Name  string `json:"name"`
	Scope string `json:"scope"`
}

type fileBrowserUser struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	Permissions struct {
		Admin bool `json:"admin"`
	} `json:"permissions"`
	Scopes []userScope `json:"scopes"`
}

// scopeFor returns the user's scope value for a given FileBrowser source
// (e.g. "share" or "home"), and whether the user has any scope for it at
// all. A user with no scope for a source cannot reach it through FBQ.
func (u fileBrowserUser) scopeFor(source string) (string, bool) {
	for _, scope := range u.Scopes {
		if scope.Name == source {
			return scope.Scope, true
		}
	}
	return "", false
}

type profile struct {
	DisplayName string `json:"displayName"`
}

type profileResponse struct {
	UID         string `json:"uid"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type profileFile struct {
	Version  int                `json:"version"`
	Profiles map[string]profile `json:"profiles"`
}

type ownership struct {
	UploadedByUID      string    `json:"uploadedByUid"`
	UploadedByUsername string    `json:"uploadedByUsername"`
	UploadedAt         time.Time `json:"uploadedAt"`
}

type ownershipFile struct {
	Version int                  `json:"version"`
	Records map[string]ownership `json:"records"`
}

type profileStore struct {
	mu       sync.RWMutex
	path     string
	profiles map[string]profile
}

func newProfileStore(path string) (*profileStore, error) {
	store := &profileStore{path: path, profiles: make(map[string]profile)}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read profiles: %w", err)
	}

	var payload profileFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("decode profiles: %w", err)
	}
	if payload.Profiles != nil {
		store.profiles = payload.Profiles
	}
	return store, nil
}

func (s *profileStore) get(uid string) (profile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.profiles[uid]
	return value, ok
}

func (s *profileStore) all() map[string]profile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]profile, len(s.profiles))
	for uid, value := range s.profiles {
		result[uid] = value
	}
	return result
}

func (s *profileStore) set(uid, displayName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.profiles[uid]
	s.profiles[uid] = profile{DisplayName: displayName}
	if err := s.saveLocked(); err != nil {
		if existed {
			s.profiles[uid] = previous
		} else {
			delete(s.profiles, uid)
		}
		return err
	}
	return nil
}

func (s *profileStore) delete(uid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.profiles[uid]
	delete(s.profiles, uid)
	if err := s.saveLocked(); err != nil {
		if existed {
			s.profiles[uid] = previous
		}
		return err
	}
	return nil
}

func (s *profileStore) saveLocked() error {
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create profile directory: %w", err)
	}
	payload, err := json.MarshalIndent(profileFile{Version: 1, Profiles: s.profiles}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode profiles: %w", err)
	}
	temporary, err := os.CreateTemp(directory, "profiles-*.tmp")
	if err != nil {
		return fmt.Errorf("create profile temp file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure profile temp file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write profiles: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync profiles: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close profiles: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace profiles: %w", err)
	}
	return nil
}

type ownershipStore struct {
	mu      sync.RWMutex
	path    string
	records map[string]ownership
}

func newOwnershipStore(path string) (*ownershipStore, error) {
	store := &ownershipStore{path: path, records: make(map[string]ownership)}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read ownership: %w", err)
	}

	var payload ownershipFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("decode ownership: %w", err)
	}
	if payload.Records != nil {
		store.records = payload.Records
	}
	return store, nil
}

func (s *ownershipStore) lookup(paths []string) map[string]ownership {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]ownership, len(paths))
	for _, path := range paths {
		if record, ok := s.records[path]; ok {
			result[path] = record
		}
	}
	return result
}

func (s *ownershipStore) set(path string, record ownership) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.records[path]
	s.records[path] = record
	if err := s.saveLocked(); err != nil {
		if existed {
			s.records[path] = previous
		} else {
			delete(s.records, path)
		}
		return err
	}
	return nil
}

func (s *ownershipStore) delete(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.records[path]
	if !existed {
		return nil
	}
	delete(s.records, path)
	if err := s.saveLocked(); err != nil {
		s.records[path] = previous
		return err
	}
	return nil
}

// move relocates a record from one path to another, carrying the original
// uploader forward across renames and trash moves, and also relocates every
// record nested under `from` (a folder move carries its children's owners
// along too). A missing source record is not an error — the destination
// simply ends up with no known owner.
func (s *ownershipStore) move(from, to string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	relocations := map[string]string{}
	if _, existed := s.records[from]; existed {
		relocations[from] = to
	}
	prefix := from + "/"
	for path := range s.records {
		if strings.HasPrefix(path, prefix) {
			relocations[path] = to + "/" + strings.TrimPrefix(path, prefix)
		}
	}
	if len(relocations) == 0 {
		return nil
	}

	undo := make(map[string]ownership, len(relocations))
	removed := make(map[string]ownership, len(relocations))
	for oldPath, newPath := range relocations {
		if previous, hadIt := s.records[newPath]; hadIt {
			undo[newPath] = previous
		}
		removed[oldPath] = s.records[oldPath]
		s.records[newPath] = s.records[oldPath]
		delete(s.records, oldPath)
	}
	if err := s.saveLocked(); err != nil {
		for oldPath, newPath := range relocations {
			delete(s.records, newPath)
			if previous, hadIt := undo[newPath]; hadIt {
				s.records[newPath] = previous
			}
			s.records[oldPath] = removed[oldPath]
		}
		return err
	}
	return nil
}

func (s *ownershipStore) saveLocked() error {
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create ownership directory: %w", err)
	}
	payload, err := json.MarshalIndent(ownershipFile{Version: 1, Records: s.records}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode ownership: %w", err)
	}
	temporary, err := os.CreateTemp(directory, "ownership-*.tmp")
	if err != nil {
		return fmt.Errorf("create ownership temp file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure ownership temp file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write ownership: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync ownership: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close ownership: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace ownership: %w", err)
	}
	return nil
}

// apiServerConfig replaces newAPIServer's earlier, ever-growing positional
// argument list. QuotaPath/HomePath/ProxyTransport exist ahead of the quota
// store and reverse-proxy gate that consume them (added in later tasks) so
// every call site only has to change signature shape once.
type apiServerConfig struct {
	StatPath, SharePath, HomePath         string
	ProfilePath, OwnershipPath, QuotaPath string
	ProxmoxConfigPath                     string
	FileBrowserURL, OnlyOfficeURL         string
	Client                                *http.Client      // identity lookups, 5s timeout
	ProxyTransport                        http.RoundTripper // uploads; no timeout
}

type apiServer struct {
	statPath       string
	sharePath      string
	homePath       string
	fileBrowserURL string
	client         *http.Client
	profiles       *profileStore
	ownerships     *ownershipStore
	quotas         *quotaStore
	usage          *usageTracker
	proxy          *httputil.ReverseProxy
	onlyOfficeURL  string
	disks          *diskMonitor
}

const usageCacheTTL = 30 * time.Second

func newAPIServer(cfg apiServerConfig) (*apiServer, error) {
	profiles, err := newProfileStore(cfg.ProfilePath)
	if err != nil {
		return nil, err
	}
	ownerships, err := newOwnershipStore(cfg.OwnershipPath)
	if err != nil {
		return nil, err
	}
	quotas, err := newQuotaStore(cfg.QuotaPath)
	if err != nil {
		return nil, err
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	proxyTransport := cfg.ProxyTransport
	if proxyTransport == nil {
		proxyTransport = http.DefaultTransport.(*http.Transport).Clone()
	}
	proxy, err := newResourcesProxy(cfg.FileBrowserURL, proxyTransport)
	if err != nil {
		return nil, err
	}
	return &apiServer{
		statPath:       cfg.StatPath,
		sharePath:      cfg.SharePath,
		homePath:       cfg.HomePath,
		fileBrowserURL: strings.TrimRight(cfg.FileBrowserURL, "/"),
		client:         client,
		profiles:       profiles,
		ownerships:     ownerships,
		quotas:         quotas,
		usage:          newUsageTracker(usageCacheTTL),
		proxy:          proxy,
		onlyOfficeURL:  cfg.OnlyOfficeURL,
		disks:          newDiskMonitor(cfg.ProxmoxConfigPath),
	}, nil
}

func (s *apiServer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/storage", s.handleStorage)
	mux.HandleFunc("/config", s.handleConfig)
	mux.HandleFunc("/profile", s.handleMyProfile)
	mux.HandleFunc("/profiles", s.handleProfiles)
	mux.HandleFunc("/profiles/", s.handleProfileByUID)
	mux.HandleFunc("/ownership", s.handleOwnership)
	mux.HandleFunc("/ownership/lookup", s.handleOwnershipLookup)
	mux.HandleFunc("/ownership/move", s.handleOwnershipMove)
	mux.HandleFunc("/quota", s.handleQuota)
	mux.HandleFunc("/quotas", s.handleQuotas)
	mux.HandleFunc("/quotas/", s.handleQuotaByUID)
	mux.HandleFunc("/api/resources", s.handleResourcesGate)
	mux.HandleFunc("/system/disks", s.handleSystemDisks)
	return mux
}

func (s *apiServer) handleStorage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(s.statPath, &stat); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	writeJSON(w, http.StatusOK, storageResponse{UsedBytes: total - free, TotalBytes: total})
}

func (s *apiServer) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	writeJSON(w, http.StatusOK, configResponse{OnlyOfficeURL: s.onlyOfficeURL})
}

func (s *apiServer) handleMyProfile(w http.ResponseWriter, r *http.Request) {
	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	uid := strconv.Itoa(user.ID)

	switch r.Method {
	case http.MethodGet:
		displayName := user.Username
		if saved, ok := s.profiles.get(uid); ok {
			displayName = saved.DisplayName
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, profileResponse{UID: uid, Username: user.Username, DisplayName: displayName})
	case http.MethodPut:
		displayName, ok := decodeDisplayName(w, r)
		if !ok {
			return
		}
		if err := s.profiles.set(uid, displayName); err != nil {
			log.Printf("save profile for uid %s: %v", uid, err)
			http.Error(w, "Could not save profile.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, profileResponse{UID: uid, Username: user.Username, DisplayName: displayName})
	default:
		methodNotAllowed(w, http.MethodGet, http.MethodPut)
	}
}

func (s *apiServer) handleProfiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"profiles": s.profiles.all()})
}

func (s *apiServer) handleProfileByUID(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	uid, err := canonicalUID(strings.TrimPrefix(r.URL.Path, "/profiles/"))
	if err != nil {
		http.Error(w, "Invalid UID.", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPut:
		target, status, err := s.fetchUser(r, uid)
		if err != nil {
			writeUpstreamError(w, status, err)
			return
		}
		displayName, ok := decodeDisplayName(w, r)
		if !ok {
			return
		}
		if err := s.profiles.set(uid, displayName); err != nil {
			log.Printf("save profile for uid %s: %v", uid, err)
			http.Error(w, "Could not save profile.", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, profileResponse{UID: uid, Username: target.Username, DisplayName: displayName})
	case http.MethodDelete:
		if err := s.profiles.delete(uid); err != nil {
			log.Printf("delete profile for uid %s: %v", uid, err)
			http.Error(w, "Could not delete profile.", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		methodNotAllowed(w, http.MethodPut, http.MethodDelete)
	}
}

func (s *apiServer) handleOwnership(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		s.handleOwnershipStamp(w, r)
	case http.MethodDelete:
		s.handleOwnershipDelete(w, r)
	default:
		methodNotAllowed(w, http.MethodPost, http.MethodDelete)
	}
}

// handleOwnershipStamp records the calling user as the uploader of a path.
// The identity always comes from the authenticated session, never the
// request body, so a caller cannot stamp a file with someone else's name.
func (s *apiServer) handleOwnershipStamp(w http.ResponseWriter, r *http.Request) {
	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	path, ok := decodeOwnershipPath(w, r)
	if !ok {
		return
	}
	record := ownership{
		UploadedByUID:      strconv.Itoa(user.ID),
		UploadedByUsername: user.Username,
		UploadedAt:         time.Now().UTC(),
	}
	if err := s.ownerships.set(path, record); err != nil {
		log.Printf("save ownership for %s: %v", path, err)
		http.Error(w, "Could not save ownership.", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *apiServer) handleOwnershipDelete(w http.ResponseWriter, r *http.Request) {
	if _, status, err := s.fetchUser(r, "self"); err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path is required.", http.StatusBadRequest)
		return
	}
	if err := s.ownerships.delete(path); err != nil {
		log.Printf("delete ownership for %s: %v", path, err)
		http.Error(w, "Could not delete ownership.", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleOwnershipLookup batch-reads ownership records for a directory listing
// or a set of selected items in one round trip.
func (s *apiServer) handleOwnershipLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if _, status, err := s.fetchUser(r, "self"); err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	var body struct {
		Paths []string `json:"paths"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": s.ownerships.lookup(body.Paths)})
}

// handleOwnershipMove carries an ownership record forward across a rename or
// a trash move so delete permission survives the path change.
func (s *apiServer) handleOwnershipMove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if _, status, err := s.fetchUser(r, "self"); err != nil {
		writeUpstreamError(w, status, err)
		return
	}
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return
	}
	if body.From == "" || body.To == "" {
		http.Error(w, "from and to are required.", http.StatusBadRequest)
		return
	}
	if err := s.ownerships.move(body.From, body.To); err != nil {
		log.Printf("move ownership from %s to %s: %v", body.From, body.To, err)
		http.Error(w, "Could not move ownership.", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeOwnershipPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct {
		Path string `json:"path"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return "", false
	}
	if body.Path == "" {
		http.Error(w, "path is required.", http.StatusBadRequest)
		return "", false
	}
	return body.Path, true
}

func (s *apiServer) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	user, status, err := s.fetchUser(r, "self")
	if err != nil {
		writeUpstreamError(w, status, err)
		return false
	}
	if !user.Permissions.Admin {
		http.Error(w, "Administrator access required.", http.StatusForbidden)
		return false
	}
	return true
}

func (s *apiServer) fetchUser(r *http.Request, id string) (fileBrowserUser, int, error) {
	var user fileBrowserUser
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, s.fileBrowserURL+"/api/users?id="+id, nil)
	if err != nil {
		return user, http.StatusBadGateway, err
	}
	for _, header := range []string{"Cookie", "Authorization", "X-Auth"} {
		if value := r.Header.Get(header); value != "" {
			request.Header.Set(header, value)
		}
	}
	response, err := s.client.Do(request)
	if err != nil {
		return user, http.StatusBadGateway, fmt.Errorf("authenticate with FileBrowser: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return user, response.StatusCode, fmt.Errorf("FileBrowser returned %s", response.Status)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&user); err != nil {
		return user, http.StatusBadGateway, fmt.Errorf("decode FileBrowser user: %w", err)
	}
	if user.ID <= 0 {
		return user, http.StatusBadGateway, errors.New("FileBrowser returned an invalid user ID")
	}
	return user, http.StatusOK, nil
}

func decodeDisplayName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var payload profile
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		http.Error(w, "Invalid profile payload.", http.StatusBadRequest)
		return "", false
	}
	displayName, err := validateDisplayName(payload.DisplayName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return "", false
	}
	return displayName, true
}

func validateDisplayName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("Display name is required.")
	}
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxDisplayNameRunes {
		return "", fmt.Errorf("Display name must be at most %d characters.", maxDisplayNameRunes)
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return "", errors.New("Display name contains unsupported characters.")
		}
	}
	return value, nil
}

func canonicalUID(value string) (string, error) {
	id, err := strconv.Atoi(value)
	if err != nil || id <= 0 {
		return "", errors.New("invalid UID")
	}
	return strconv.Itoa(id), nil
}

func writeUpstreamError(w http.ResponseWriter, status int, err error) {
	if status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusNotFound {
		http.Error(w, http.StatusText(status), status)
		return
	}
	log.Printf("FileBrowser identity lookup failed: %v", err)
	http.Error(w, "Identity service unavailable.", http.StatusBadGateway)
}

func methodNotAllowed(w http.ResponseWriter, methods ...string) {
	w.Header().Set("Allow", strings.Join(methods, ", "))
	http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func main() {
	statPath := envOrDefault("NASAPI_STAT_PATH", "/srv/share")
	sharePath := envOrDefault("NASAPI_SHARE_PATH", "/srv/share")
	homePath := envOrDefault("NASAPI_HOME_PATH", "/srv/home")
	dataPath := envOrDefault("NASAPI_DATA_PATH", "/var/lib/vaulta")
	fileBrowserURL := envOrDefault("NASAPI_FILEBROWSER_URL", "http://127.0.0.1:30334")
	onlyOfficeURL := envOrDefault("NASAPI_ONLYOFFICE_URL", "")
	port := envOrDefault("NASAPI_PORT", "9190")

	server, err := newAPIServer(apiServerConfig{
		StatPath:          statPath,
		SharePath:         sharePath,
		HomePath:          homePath,
		ProfilePath:       filepath.Join(dataPath, "profiles.json"),
		OwnershipPath:     filepath.Join(dataPath, "ownership.json"),
		QuotaPath:         filepath.Join(dataPath, "quotas.json"),
		ProxmoxConfigPath: filepath.Join(dataPath, "proxmox.json"),
		FileBrowserURL:    fileBrowserURL,
		OnlyOfficeURL:     onlyOfficeURL,
	})
	if err != nil {
		log.Fatal(err)
	}

	addr := "127.0.0.1:" + port
	log.Printf("nasapi listening on %s, stat path %s, share path %s, home path %s, profile path %s", addr, statPath, sharePath, homePath, dataPath)
	log.Fatal(http.ListenAndServe(addr, server.handler()))
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
