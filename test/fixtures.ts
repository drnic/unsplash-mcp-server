export const samplePhoto = (overrides: Record<string, any> = {}) => ({
  id: "abc123",
  description: "A mountain",
  alt_description: "snow-capped mountains",
  urls: { raw: "https://images.unsplash.com/raw", regular: "https://images.unsplash.com/regular" },
  width: 4000,
  height: 3000,
  color: "#a3c4f3",
  blur_hash: "LKO2?U%2Tw=w",
  user: { username: "johndoe", name: "John Doe" },
  links: {
    html: "https://unsplash.com/photos/abc123",
    download_location: "https://api.unsplash.com/photos/abc123/download?ixid=xyz",
  },
  ...overrides,
});
