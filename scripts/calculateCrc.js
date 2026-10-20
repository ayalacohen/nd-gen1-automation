function calculateCRC8(command) {
    const values = Buffer.from(command, "utf8"); // Encoding.UTF8.GetBytes
    let crc = 0;

    for (let i = 0; i < values.length; i++) {
        let inbyte = values[i];
        if (inbyte < 0) {
            inbyte += 256;
        }

        for (let j = 0; j < 8; j++) {
            const mix = (crc ^ inbyte) & 0x01;
            crc >>= 1;
            if (mix !== 0) {
                crc ^= 0x8C;
            }
            inbyte >>= 1;
        }
    }

    return crc & 0xff;
}

// ---- CLI wrapper ----
const args = process.argv.slice(2);
const input = args.length > 0 ? args.join(" ") : "start 60 0 endstart 61 24 124 1 end"; // default command string
const crc = calculateCRC8(input);

console.log(crc); // decimal only
