module.exports = function (RED) {
    const got = require('got');

    function StreamClientNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        let reconnectTimer = null;
        let stream = null;

        const reconnectDelay = parseInt(config.reconnectDelay) || 5000;

        function updateStatus(color, shape, text) {
            node.status({ fill: color, shape: shape, text: text });
        }

        function closeStream() {
            if (stream) {
                try {
                    stream.destroy();
                } catch (err) {
                    node.warn(`Error closing stream: ${err.message}`);
                }
                stream = null;
            }
        }

        async function connect() {
            closeStream();
            if (!config.url || !/^https?:\/\//.test(config.url)) {
                node.error("No valid URL specified");
                updateStatus("red", "dot", "no valid URL");
                return;
            }

            let headers = {};
            if (config.token) {
                headers['Authorization'] = `Bearer ${config.token}`;
            }
            if (config.headers) {
                try {
                    const extraHeaders = JSON.parse(config.headers);
                    headers = { ...headers, ...extraHeaders };
                } catch (err) {
                    node.warn("Invalid JSON in headers");
                }
            }

            let url = config.url;
            if (config.query) {
                url += (url.includes('?') ? '&' : '?') + config.query;
            }

            updateStatus("yellow", "dot", "connecting...");

            try {
                stream = got.stream(url, {
                    headers,
                    timeout: { request: 0 },
                    retry: { limit: 0 }
                });

                stream.on('data', (chunk) => {
                    const lines = chunk.toString().split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line);
                            node.send({ payload: parsed, _raw: line });
                        } catch (err) {
                            if (config.debug) node.warn(`Invalid JSON: ${line}`);
                        }
                    }
                });

                stream.on('response', () => {
                    updateStatus("green", "dot", "connected");
                });

                stream.on('error', (err) => {
                    node.error(`Stream error: ${err.message}`);
                    updateStatus("red", "dot", "error - reconnecting...");
                    scheduleReconnect();
                });

                stream.on('end', () => {
                    updateStatus("grey", "ring", "stream ended - reconnecting...");
                    scheduleReconnect();
                });

            } catch (err) {
                node.error(`Connection failed: ${err.message}`);
                updateStatus("red", "dot", "connection failed - reconnecting...");
                scheduleReconnect();
            }
        }

        function scheduleReconnect() {
            closeStream();
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, reconnectDelay);
        }

        node.on('close', (done) => {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            closeStream();
            done();
        });

        connect();
    }

    RED.nodes.registerType("stream-client", StreamClientNode);
};
