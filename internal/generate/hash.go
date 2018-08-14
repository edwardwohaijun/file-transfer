package generate

import (
	"io"
	"hash"
	"encoding/hex"
)

// credit: https://stackoverflow.com/questions/25671305/golang-io-copy-twice-on-the-request-body
// this works for either a reader or writer,
//  but if you use both in the same time the hash will be wrong.
type Hasher struct {
	io.Writer
	io.Reader
	hash.Hash
	Size uint64
}

func (h *Hasher) Write(p []byte) (n int, err error) {
	n, err = h.Writer.Write(p)
	h.Hash.Write(p)
	h.Size += uint64(n)
	return
}

func (h *Hasher) Read(p []byte) (n int, err error) {
	n, err = h.Reader.Read(p)
	h.Hash.Write(p[:n]) //on error n is gonna be 0 so this is still safe.
	return
}

func (h *Hasher) Sum() string {
	return hex.EncodeToString(h.Hash.Sum(nil))
}
