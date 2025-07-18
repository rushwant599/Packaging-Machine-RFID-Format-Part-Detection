const express = require('express');
const path = require('path');
const { OPCUAClient } = require('node-opcua');

const app = express();
const port = 8080;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Serve layout.html as homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'layout.html'));
});

// OPC UA config
const endpointUrl = "opc.tcp://192.168.0.1:4840"; // 🔁 Replace with your antenna's OPC UA URL
const nodeId = "ns=2;s=RFIDTags"; // 🔁 Replace with actual nodeId returning RFID list

app.get('/api/opcua', async (req, res) => {
  const client = OPCUAClient.create({ endpointMustExist: false });

  try {
    await client.connect(endpointUrl);
    const session = await client.createSession();

    const dataValue = await session.readVariableValue(nodeId);

    await session.close();
    await client.disconnect();

    const tagString = dataValue.value.value;
    const tags = typeof tagString === 'string'
      ? tagString.split(',').map(t => t.trim())
      : [];

    res.json({ tags });
  } catch (err) {
    console.error("OPCUA Error:", err.message);
    res.status(500).json({ error: "Failed to fetch RFID tags" });
  }
});

app.listen(port, () => {
  console.log(`RFID app listening at http://localhost:${port}`);
});
