/**
 * Demultiplex Docker container log output.
 * Docker uses an 8-byte header per frame when TTY is not attached:
 *   [stream_type(1), 0, 0, 0, size(4 big-endian)] followed by `size` bytes of payload.
 */
export function demuxDockerLogs(buffer: Buffer): string {
  if (typeof buffer === "string") return buffer;

  const isMultiplexed =
    buffer.length >= 8 &&
    (buffer[0] === 0 || buffer[0] === 1 || buffer[0] === 2) &&
    buffer[1] === 0 &&
    buffer[2] === 0 &&
    buffer[3] === 0;

  if (!isMultiplexed) {
    return buffer.toString("utf-8");
  }

  const lines: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buffer.length) break;
    lines.push(buffer.subarray(offset, offset + size).toString("utf-8"));
    offset += size;
  }

  return lines.join("");
}
