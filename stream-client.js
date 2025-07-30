const got = require('got');
const readline = require('readline');

module.exports = function (RED) {
  function StreamClientNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    let stopped = false;
    let stream = null;
    let rl = null;

    const buildUrl = () => {
      let url = config.url.trim();
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
          Object.assign(headers, parsed);
        } catch (err) {
          node.warn('Invalid headers JSON');
        }
      }
      return headers;
    };

    const connect = () => {
      if (stopped) return;

      const url = buildUrl();
      const headers = buildHeaders();

      node.status({ fill: 'blue', shape: 'ring', text: 'connecting' });
      if (config.debug) {
        node.log(`Connecting to ${url}`);
        node.log(`Headers: ${JSON.stringify(headers)}`);
      }

      try {
        stream = got.stream(url, { headers });
        rl = readline.createInterface({ input: stream });

        rl.on('line', (line) => {
          if (!line.trim()) return;
          try {
            const data = JSON.parse(line);
            node.send({ payload: data });
            node.status({ fill: 'green', shape: 'dot', text: 'connected' });
          } catch (err) {
            node.warn(`Invalid JSON line: ${line}`);
          }
        });

        stream.on('end', () => {
          node.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });
          if (!stopped) reconnect();
        });

        stream.on('error', (err) => {
          node.status({ fill: 'red', shape: 'dot', text: 'error' });
          node.error('Stream error: ' + err.message);
          if (!stopped) reconnect();
        });

      } catch (err) {
        node.error('Failed to start stream: ' + err.message);
        reconnect();
      }
    };

    const reconnect = () => {
      const delay = parseInt(config.reconnectDelay || '5000', 10);
      if (config.debug) node.log(`Reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    };

    connect();

    node.on('close', () => {
      stopped = true;
      if (rl) rl.close();
      if (stream) stream.destroy();
    });
  }

  RED.nodes.registerType('stream-client', StreamClientNode);
};