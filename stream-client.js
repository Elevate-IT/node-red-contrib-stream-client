module.exports = function (RED) {
    const got = require("got");

    function StreamClientNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        let stream;
        let reconnectTimeout;
        let reconnectDelay = 2000; // Start with 2s
        const maxReconnectDelay = 60000; // Cap at 60s

        function startStream() {
            if (!config.url) {
                node.status({ fill: "red", shape: "ring", text: "no URL" });
                node.error("No URL specified");
                return;
            }

            let url = config.url;
            const headers = {};

            if (config.authToken) {
                headers["Authorization"] = `Bearer ${config.authToken}`;
            }

            if (config.headers) {
                try {
                    const extraHeaders = JSON.parse(config.headers);
                    Object.assign(headers, extraHeaders);
                } catch (err) {
                    node.warn("Invalid headers JSON, ignoring extra headers");
                }
            }

            if (config.params) {
                const urlObj = new URL(url);
                try {
                    const extraParams = JSON.parse(config.params);
                    Object.entries(extraParams).forEach(([k, v]) => {
                        urlObj.searchParams.set(k, v);
                    });
                    url = urlObj.toString();
                } catch (err) {
                    node.warn("Invalid params JSON, ignoring extra params");
                }
            }

            if (config.debug) {
                node.log(`Connecting to: ${url}`);
                node.log(`Headers: ${JSON.stringify(headers)}`);
            }

            node.status({ fill: "yellow", shape: "dot", text: "connecting" });

            try {
                stream = got.stream(url, {
                    headers,
                    timeout: {
                        // Disable main request timeout; only limit DNS/TCP/TLS stages
                        lookup: 30000,
                        connect: 30000,
                        secureConnect: 30000,
                        socket: 0,
                        send: 0,
                        response: 0
                    },
                    retry: { limit: 0 }
                });

                stream.on("response", (res) => {
                    if (config.debug) node.log(`Connected, status ${res.statusCode}`);
                    node.status({ fill: "green", shape: "dot", text: "connected" });
                    reconnectDelay = 2000; // Reset backoff on success
                });

                stream.on("data", (chunk) => {
                    const data = chunk.toString().trim();
                    if (data) {
                        if (config.debug) node.log(`Data: ${data}`);
                        node.send({ payload: data });
                    }
                });

                stream.on("error", (err) => {
                    node.error(`Stream error: ${err.message}`);
                    node.status({ fill: "red", shape: "ring", text: "error" });
                    scheduleReconnect();
                });

                stream.on("end", () => {
                    node.warn("Stream ended by server");
                    node.status({ fill: "red", shape: "ring", text: "disconnected" });
                    scheduleReconnect();
                });

            } catch (err) {
                node.error(`Failed to start stream: ${err.message}`);
                scheduleReconnect();
            }
        }

        function scheduleReconnect() {
            stopStream();
            clearTimeout(reconnectTimeout);
            node.status({ fill: "yellow", shape: "ring", text: `reconnecting in ${reconnectDelay / 1000}s` });

            reconnectTimeout = setTimeout(() => {
                startStream();
                reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
            }, reconnectDelay);
        }

        function stopStream() {
            if (stream) {
                try {
                    stream.destroy();
                } catch (e) {
                    // Ignore
                }
                stream = null;
            }
        }

        node.on("close", () => {
            stopStream();
            clearTimeout(reconnectTimeout);
        });

        startStream();
    }

    RED.nodes.registerType("stream-client", StreamClientNode);
};
