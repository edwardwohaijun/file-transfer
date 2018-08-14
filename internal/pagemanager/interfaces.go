package pagemanager

// Each file has a fileID, which can be a random string, or hashing result of its content.
// This type must implement name() function returning a string as fileID.
type FileNamer interface {
	name(struct{}) string
}
