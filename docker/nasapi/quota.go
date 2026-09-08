package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// quotaRecord is the admin-set storage limit for one user's private drive.
type quotaRecord struct {
	LimitBytes int64 `json:"limitBytes"`
}

type quotaFile struct {
	Version int                    `json:"version"`
	Quotas  map[string]quotaRecord `json:"quotas"`
}

// quotaStore is a small JSON-file-backed store mapping FileBrowser uid to a
// quotaRecord, mirroring profileStore's locking and atomic-write pattern
// exactly. A uid with no record is not tracked as "unlimited" — callers
// treat an absent record as 0 bytes allowed (fail closed).
type quotaStore struct {
	mu     sync.RWMutex
	path   string
	quotas map[string]quotaRecord
}

func newQuotaStore(path string) (*quotaStore, error) {
	store := &quotaStore{path: path, quotas: make(map[string]quotaRecord)}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read quotas: %w", err)
	}

	var payload quotaFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("decode quotas: %w", err)
	}
	if payload.Quotas != nil {
		store.quotas = payload.Quotas
	}
	return store, nil
}

func (s *quotaStore) get(uid string) (quotaRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.quotas[uid]
	return value, ok
}

func (s *quotaStore) all() map[string]quotaRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]quotaRecord, len(s.quotas))
	for uid, value := range s.quotas {
		result[uid] = value
	}
	return result
}

func (s *quotaStore) set(uid string, limit int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.quotas[uid]
	s.quotas[uid] = quotaRecord{LimitBytes: limit}
	if err := s.saveLocked(); err != nil {
		if existed {
			s.quotas[uid] = previous
		} else {
			delete(s.quotas, uid)
		}
		return err
	}
	return nil
}

func (s *quotaStore) delete(uid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, existed := s.quotas[uid]
	if !existed {
		return nil
	}
	delete(s.quotas, uid)
	if err := s.saveLocked(); err != nil {
		s.quotas[uid] = previous
		return err
	}
	return nil
}

func (s *quotaStore) saveLocked() error {
	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create quota directory: %w", err)
	}
	payload, err := json.MarshalIndent(quotaFile{Version: 1, Quotas: s.quotas}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode quotas: %w", err)
	}
	temporary, err := os.CreateTemp(directory, "quotas-*.tmp")
	if err != nil {
		return fmt.Errorf("create quota temp file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure quota temp file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write quotas: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync quotas: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close quotas: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace quotas: %w", err)
	}
	return nil
}
