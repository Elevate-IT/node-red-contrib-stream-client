const got = require("got");

module.exports = function (RED) {
  function StreamClientNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    let stream = null;
    let reconnectTimer = null;
    let reconnectDelay = 5000; // start at 5s
    const maxDelay = 60000;    // cap at 60s

    function safeReconnect() {
      if (reconnectTimer) return;
      node.status({ fill: "yellow", shape: "dot", text: `reconnecting in ${reconnectDelay / 1000}s` });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startStream();
      }, reconnectDelay);

      // exponential backoff
      reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
    }

    function resetBackoff() {
      reconnectDelay = 5000; // reset on success
    }

    function startStream() {
      if (stream) {
        stream.destroy();
        stream = null;
      }

      const url = config.url;
      const headers = {};

      if (config.token) {
        headers["Authorization"] = `Bearer ${config.token}`;
      }

      node.status({ fill: "blue", shape: "dot", text: "connecting" });

      try {
        stream = got.stream(url, {
          headers,
          retry: { limit: 0 },
          https: { rejectUnauthorized: false }, // allow self-signed if needed
          throwHttpErrors: false,               // don't throw for 4xx/5xx
          timeout: { request: 30000 },          // 30s request timeout
          hooks: {
            beforeError: [
              (error) => {
                // Downgrade got’s HTTPError so it won’t crash Node-RED
                if (error.name === "HTTPError") {
                  error.name = "NonFatalHTTPError";
                }
                return error;
              },
            ],
          },
        });

        stream.on("response", (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            node.status({ fill: "green", shape: "dot", text: "connected" });
            resetBackoff();
          } else {
            node.status({ fill: "red", shape: "ring", text: `HTTP ${response.statusCode}` });
            node.error(`Stream error: HTTP ${response.statusCode}`);
            safeReconnect();
          }
        });

        stream.on("data", (chunk) => {
          const data = chunk.toString().trim();
          if (data) {
            node.send({ payload: data });
          }
        });

        stream.on("error", (err) => {
          node.status({ fill: "red", shape: "dot", text: "error" });
          node.error(`Stream error: ${err.name} - ${err.message}`);
          safeReconnect();
        });

        stream.on("end", () => {
          node.status({ fill: "yellow", shape: "ring", text: "disconnected" });
          safeReconnect();
        });
      } catch (err) {
        node.status({ fill: "red", shape: "dot", text: "exception" });
        node.error(`Exception in startStream: ${err.message}`);
        safeReconnect();
      }
    }

    startStream();

    node.on("close", () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (stream) {
        stream.destroy();
        stream = null;
      }
    });
  }

  RED.nodes.registerType("stream-client", StreamClientNode);
};
