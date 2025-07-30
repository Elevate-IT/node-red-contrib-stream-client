const got = require('got');
const readline = require('readline');

module.exports = function (RED) {
  /**
   * StreamClientNode constructor.
   * Initializes the Node-RED custom node.
   * @param {object} config - The configuration object for the node.
   */
  function StreamClientNode(config) {
    RED.nodes.createNode(this, config); // Initialize the node with Node-RED's core functionality
    const node = this; // Reference to the current node instance

    let stopped = false; // Flag to indicate if the node has been stopped/closed
    let stream = null;   // Holds the 'got' stream instance
    let rl = null;       // Holds the readline interface instance
    let reconnectTimeout = null; // Holds the ID of the setTimeout for reconnection

    /**
     * Clears any pending reconnection timeout.
     * This is crucial to prevent reconnect attempts after the node is closed.
     */
    const clearReconnectTimeout = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    /**
     * Constructs the full URL for the stream, including query parameters.
     * @returns {string} The complete URL.
     */
    const buildUrl = () => {
      let url = config.url.trim();
      const params = new URLSearchParams(config.query || ''); // Create URLSearchParams from query string

      // Append query parameters if any exist
      if ([...params].length > 0) {
        url += (url.includes('?') ? '&' : '?') + params.toString();
      }
      return url;
    };

    /**
     * Builds the headers object, including Authorization token and extra headers.
     * Handles JSON parsing for extra headers with error handling.
     * @returns {object} The headers object.
     */
    const buildHeaders = () => {
      const headers = {};
      // Add Bearer token if provided
      if (config.token) {
        headers['Authorization'] = `Bearer ${config.token}`;
      }

      // Parse and add extra headers from JSON string
      if (config.headers) {
        try {
          const parsed = JSON.parse(config.headers);
          // Ensure parsed result is an object before merging
          if (typeof parsed === 'object' && parsed !== null) {
            Object.assign(headers, parsed);
          } else {
            node.warn('Invalid headers JSON: Must be an object. Skipping extra headers.');
          }
        } catch (err) {
          node.warn(`Invalid headers JSON format: ${err.message}. Skipping extra headers.`);
        }
      }
      return headers;
    };

    /**
     * Cleans up existing stream and readline resources.
     * This is called before establishing a new connection or when the node is closed.
     */
    const cleanupStream = () => {
      if (rl) {
        rl.close(); // Close the readline interface
        rl = null;
      }
      if (stream) {
        stream.destroy(); // Destroy the 'got' stream
        stream = null;
      }
      clearReconnectTimeout(); // Ensure no pending reconnects associated with this stream
    };

    /**
     * Establishes a connection to the stream.
     * Handles connection setup, data processing, and error handling.
     */
    const connect = () => {
      // If the node has been stopped, do not attempt to connect
      if (stopped) {
        node.status({ fill: 'grey', shape: 'dot', text: 'stopped' });
        return;
      }

      cleanupStream(); // Clean up any existing stream/readline before attempting a new connection

      const url = buildUrl();
      const headers = buildHeaders();
      const initialConnectTimeoutMs = 15000; // Timeout for the initial connection attempt

      node.status({ fill: 'blue', shape: 'ring', text: 'connecting...' });
      if (config.debug) {
        node.log(`Attempting to connect to: ${url}`);
        node.log(`Headers used: ${JSON.stringify(headers)}`);
      }

      try {
        // Use got.stream for streaming data over HTTP/HTTPS.
        // Add a request timeout to prevent hanging connections.
        stream = got.stream(url, {
          headers,
          timeout: {
            request: initialConnectTimeoutMs // Timeout for the entire request
          },
          followRedirect: true // Follow HTTP redirects by default
        });

        // Create a readline interface to process data line by line
        rl = readline.createInterface({ input: stream });

        // Event listener for each line received from the stream
        rl.on('line', (line) => {
          if (!line.trim()) return; // Ignore empty lines

          try {
            const data = JSON.parse(line); // Attempt to parse the line as JSON
            node.send({ payload: data }); // Send the parsed data as a message
            node.status({ fill: 'green', shape: 'dot', text: 'connected' }); // Indicate successful data reception
          } catch (err) {
            // Warn if JSON parsing fails, showing a snippet of the problematic line
            node.warn(`Invalid JSON line received: "${line.substring(0, 100)}..." Error: ${err.message}`);
            node.status({ fill: 'yellow', shape: 'dot', text: 'parsing error' }); // Indicate a parsing issue
          }
        });

        // Event listener for raw data reception (useful for initial connection status)
        stream.on('data', () => {
            // Update status to 'connected' as soon as any data starts flowing
            node.status({ fill: 'green', shape: 'dot', text: 'connected' });
        });

        // Event listener when the stream ends (e.g., server closes connection)
        stream.on('end', () => {
          node.status({ fill: 'grey', shape: 'ring', text: 'stream ended' });
          if (!stopped) {
            node.warn('Stream ended unexpectedly. Attempting to reconnect.');
            reconnect(); // Attempt to reconnect if not explicitly stopped
          } else {
            node.log('Stream ended gracefully, as node was stopped.');
            cleanupStream(); // Final cleanup if node was already stopped
          }
        });

        // Event listener for stream errors (e.g., network issues, connection refused)
        stream.on('error', (err) => {
          node.status({ fill: 'red', shape: 'dot', text: 'error' });
          // Log the error to Node-RED's console/debug sidebar
          node.error(`Stream error: ${err.message}`, err);
          if (!stopped) {
            node.warn(`Stream error encountered. Attempting to reconnect: ${err.message}`);
            reconnect(); // Attempt to reconnect if not explicitly stopped
          } else {
            node.log('Stream error, but node was stopped.');
            cleanupStream(); // Final cleanup if node was already stopped
          }
        });

      } catch (err) {
        // Catch synchronous errors during stream initialization (e.g., invalid URL)
        node.status({ fill: 'red', shape: 'dot', text: 'setup error' });
        node.error(`Failed to initialize stream: ${err.message}`, err);
        if (!stopped) {
            node.warn(`Stream setup failed. Attempting to reconnect: ${err.message}`);
            reconnect(); // Attempt to reconnect
        } else {
            node.log('Stream setup failed, but node was stopped.');
            cleanupStream(); // Final cleanup if node was already stopped
        }
      }
    };

    /**
     * Schedules a reconnection attempt after a specified delay.
     */
    const reconnect = () => {
      if (stopped) {
        node.status({ fill: 'grey', shape: 'dot', text: 'stopped' });
        return;
      }
      clearReconnectTimeout(); // Clear any existing timeout before setting a new one

      let delay = parseInt(config.reconnectDelay, 10);
      // Validate reconnectDelay: ensure it's a number and has a minimum value
      if (isNaN(delay) || delay < 1000) {
        delay = 5000; // Default to 5 seconds if invalid
        node.warn(`Invalid or too short reconnectDelay '${config.reconnectDelay}'. Using default of ${delay}ms.`);
      }

      node.status({ fill: 'yellow', shape: 'ring', text: `reconnecting in ${delay / 1000}s` });
      if (config.debug) node.log(`Scheduling reconnect in ${delay}ms.`);

      reconnectTimeout = setTimeout(connect, delay); // Schedule the next connection attempt
    };

    // Initial connection attempt when the node is deployed/started
    connect();

    /**
     * Event listener for when the Node-RED node is closed or redeployed.
     * Performs necessary cleanup to free resources.
     * @param {function} done - Callback to signal Node-RED that cleanup is complete.
     */
    node.on('close', (done) => {
      stopped = true; // Set stopped flag to prevent further reconnects
      cleanupStream(); // Clean up active stream and readline interface
      clearReconnectTimeout(); // Clear any pending reconnect timeouts
      node.status({ fill: 'grey', shape: 'dot', text: 'closed' });
      node.log('Stream client node closed.');
      done(); // Signal Node-RED that cleanup is finished
    });
  }

  // Register the custom node type with Node-RED
  RED.nodes.registerType('stream-client', StreamClientNode);
};
