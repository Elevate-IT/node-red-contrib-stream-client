# node-red-contrib-stream-client

A Node-RED input node that connects to an HTTP NDJSON stream and parses each line into a separate message.

## Features

- Auto-reconnect with configurable delay
- Supports Bearer token and custom headers
- Accepts any query parameters
- Line-by-line JSON parsing (NDJSON)
- Debug option for verbose logging

## Install

In your Node-RED user directory:
```bash
npm install node-red-contrib-stream-client
```

## Usage

Add the **Stream Client** node to your flow. Configure:

- `URL`: Base endpoint URL
- `Bearer Token`: (optional) Authorization token
- `Extra Headers`: JSON string for additional headers
- `Query Params`: e.g. `foo=1&bar=2`
- `Reconnect Delay`: ms to wait before retrying
- `Debug`: Logs more info to Node-RED console

### Output
Each message has:
```json
{
  "payload": { ...parsed line from stream... }
}
```

## Example

```curl
curl -H "Authorization: Bearer token" \
  'https://example.com/api/stream?type=event&id=123'
```

This would stream lines like:
```json
{"event":"start","id":123}
{"event":"stop","id":123}
```

And emit one Node-RED message per line.

## License
MIT