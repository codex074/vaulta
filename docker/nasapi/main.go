package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"syscall"
)

type storageResponse struct {
	UsedBytes  uint64 `json:"usedBytes"`
	TotalBytes uint64 `json:"totalBytes"`
}

func main() {
	statPath := os.Getenv("NASAPI_STAT_PATH")
	if statPath == "" {
		statPath = "/srv/share"
	}
	port := os.Getenv("NASAPI_PORT")
	if port == "" {
		port = "9190"
	}

	http.HandleFunc("/storage", func(w http.ResponseWriter, r *http.Request) {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(statPath, &stat); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bavail * uint64(stat.Bsize)
		resp := storageResponse{UsedBytes: total - free, TotalBytes: total}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	addr := "127.0.0.1:" + port
	log.Printf("nasapi listening on %s, stat path %s", addr, statPath)
	log.Fatal(http.ListenAndServe(addr, nil))
}
