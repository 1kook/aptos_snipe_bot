import crypto from "crypto";

export function encryptData(plaintext: string, encryptionKey: Buffer) {
    const iv = crypto.randomBytes(16); // Generate a new Initialization Vector (IV) for each encryption
    const cipher = crypto.createCipheriv("aes-256-cbc", encryptionKey, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
}

// Function to decrypt data
export function decryptData(ciphertext: string, encryptionKey: Buffer) {
    const [ivHex, encrypted] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", encryptionKey, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
