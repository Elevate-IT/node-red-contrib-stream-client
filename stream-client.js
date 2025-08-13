const got = require('got');
const readline = require('readline');

module.exports = function (RED) {
  function StreamClientNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    let stopped = false;
    let stream = null;
    let rl = null;
    let reconnectTimer = null;
    let reconnecting = false;

    // Catch any unhandled errors inside this node context
    process.on('uncaughtException', (err) => {
      if (config.debug) node.warn(`Uncaught exception: ${err.message}`);
    });
    process.on('unhandledRejection', (reason) => {
      if (config.debug) node.warn(`Unhandled rejection: ${reason}`);
    });

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

    const safeReconnect = () => {
      if (stopped || reconnecting) return;
      reconnecting = true;
      const delay = parseInt(config.reconnectDelay || '5000', 10);
      if (config.debug) node.log(`Reconnecting in ${delay}ms`);
      reconnectTimer = setTimeout(() => {
        reconnecting = false;
        connect();
      }, delay);
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
        stream = got.stream(url, { headers, retry: { limit: 0 }, timeout: {} });

        stream.on('request', (req) => {
          req.on('error', (err) => {
            node.error('Request error: ' + err.message);
            safeReconnect();
          });
        });

        stream.on('response', (res) => {
          if (res.statusCode >= 400) {
            node.error(`Stream HTTP error: ${res.statusCode} ${res.statusMessage}`);
          }
          res.on('error', (err) => {
            node.error('Response error: ' + err.message);
            safeReconnect();
          });
        });

        stream.on('error', (err) => {
          node.status({ fill: 'red', shape: 'dot', text: 'error' });
          node.error('Stream error: ' + err.message);
          safeReconnect();
        });

        rl = readline.createInterface({ input: stream });

        rl.on('line', (line) => {
          if (!line.trim()) return;
          try {
            const data = JSON.parse(line);
            node.send({ payload: data });
            node.status({ fill: 'green', shape: 'dot', text: 'connected' });
          } catch {
            node.warn(`Invalid JSON from stream: ${line}`);
          }
        });

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

    node.on('close', () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (rl) rl.close();
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    });

    connect();
  }

  RED.nodes.registerType('stream-client', StreamClientNode);
};
