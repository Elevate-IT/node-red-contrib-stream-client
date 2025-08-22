const got = require("got");

module.exports = function (RED) {
  function StreamClientNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    let retryDelay = 1000; // start at 1s
    let reconnectTimer;

    const url = config.url;
    const headers = {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    };

    async function connect() {
      try {
        const response = await got(url, {
          headers,
          timeout: { request: 60000 }, // allow slow server responses
        }).json();

        // Send parsed JSON payload
        node.send({ payload: response });

        // Reset backoff on success
        retryDelay = 1000;
        reconnectTimer = setTimeout(connect, retryDelay);

      } catch (error) {
        node.error("Stream error: " + error.message);

        // Exponential backoff up to 60s
        retryDelay = Math.min(retryDelay * 2, 60000);
        reconnectTimer = setTimeout(connect, retryDelay);
      }
    }

    connect();

    node.on("close", function () {
      if (reconnectTimer) clearTimeout(reconnectTimer);
    });
  }

  RED.nodes.registerType("stream-client", StreamClientNode);
};
