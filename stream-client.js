const got = require('got');
const readline = require('readline');

module.exports = function (RED) {
  function StreamClientNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    let stopped = false;
    let stream = null;
    let rl = null;

    // Build the full stream URL with query params
    const buildUrl = () => {
      let url = (config.url || '').trim();
      if (!url) {
        node.error('No URL provided');
        return null;
      }
      const params = new URLSearchParams(config.query || '');
      if ([...params].length > 0) {
        url += (url.includes('?') ? '&' : '?') + params.toString();
      }
      return url;
    };

    // Merge Authorization + custom headers
    const buildHeaders = () => {
      const headers = {};
      if (config.token) {
        headers['Authorization'] = `Bearer ${config.token}`;
      }
      if (config.headers) {
        try {
          const parsed = JSON.parse(config.headers);
          if (typeof parsed === 'object' && parsed !== null) {
            Object.assign(headers, parsed);
          }
        } catch {
          node.warn('Invalid headers JSON - skipping custom headers');
        }
      }
      return headers;
    };

    const connect = () => {
      if (stopped) return;

      const url = buildUrl();
      if (!url) return;

      const headers = buildHeaders();

      node.status({ fill: 'blue', shape: 'ring', text: 'connecting' });

      if (config.debug) {
        node.log(`Connecting to: ${url}`);
        node.log(`Headers: ${JSON.stringify(headers)}`);
      }

      try {
        // No timeout - streaming should run indefinitely
        stream = got.stream(url, { headers });

        // Catch low-level request errors
        stream.on('request', (req) => {
          req.on('error', (err) => {
            node.error('Request error: ' + err.message);
            safeReconnect();
          });
        });

        // Catch response-level errors
        stream.on('response', (res) => {
          if (res.statusCode >= 400) {
            node.error(`Stream HTTP error: ${res.statusCode} ${res.statusMessage}`);
          }
          res.on('error', (err) => {
            node.error('Response error: ' + err.message);
            safeReconnect();
          });
        });

        // Catch any stream errors (network drops, etc.)
        stream.on('error', (err) => {
          node.status({ fill: 'red', shape: 'dot', text: 'error' });
          node.error('Stream error: ' + err.message);
          safeReconnect();
        });

        // Read line-by-line JSON messages
        rl = readline.createInterface({ input: stream });

        rl.on('line', (line) => {
          if (!line.trim()) return; // skip empty lines
          try {
            const data = JSON.parse(line);
            node.send({ payload: data });
            node.status({ fill: 'green', shape: 'dot', text: 'connected' });
          } catch {
            node.warn(`Invalid JSON from stream: ${line}`);
          }
        });

        // Handle stream end (server closed connection)
        stream.on('end', () => {
          node.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });
          safeReconnect();
        });

      } catch (err) {
        node.status({ fill: 'red', shape: 'dot', text: 'failed to connect' });
        node.error('Failed to start stream: ' + err.message);
        safeReconnect();
      }
    };

    const safeReconnect = () => {
      if (stopped) return;
      const delay = parseInt(config.reconnectDelay || '5000', 10);
      if (config.debug) node.log(`Reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    };

    node.on('close', () => {
      stopped = true;
      if (rl) rl.close();
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    });

    connect();
  }

  RED.nodes.registerType('stream-client', StreamClientNode);
};
