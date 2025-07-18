// opcua-client.js
const { OPCUAClient, NodeClass } = require("node-opcua");

const endpointUrl = "opc.tcp://<ANTENNA_IP>:4840"; // replace this
const TAG_LIST_NODE    = "ns=2;s=RFID.Tags";       // replace with real node ID
const SESSION_TIMEOUT = 60 * 1000;

async function readRfidTags() {
  const client = OPCUAClient.create({ endpoint_must_exist: false });
  await client.connect(endpointUrl);

  const session = await client.createSession();
  const nodesToBrowse = [{
    nodeId: TAG_LIST_NODE,
    nodeClassMask: NodeClass.Variable,
    resultMask: 63
  }];

  const browseResult = await session.browse(nodesToBrowse);
  console.log("Raw Tags:", browseResult.references.map(r => r.browseName.name));

  // To read values:
  const tagIds = browseResult.references.map(r => r.nodeId);
  const dataValues = await session.readVariableValue(tagIds);
  const tags = dataValues.map(dv => dv.value.value);

  await session.close();
  await client.disconnect();
  return tags;
}

// ✅ NEW FUNCTION: specifically for reading tags on demand (with logging)
async function detectNearbyRfidTags() {
  try {
    console.log("Connecting to OPC UA server to detect RFID tags...");

    const client = OPCUAClient.create({ endpoint_must_exist: false });
    await client.connect(endpointUrl);

    const session = await client.createSession();
    console.log("Session created.");

    const tagDataValue = await session.readVariableValue(TAG_LIST_NODE);
    console.log("Detected raw tag values:", tagDataValue);

    await session.close();
    await client.disconnect();

    const tags = Array.isArray(tagDataValue[0]?.value?.value)
      ? tagDataValue[0].value.value
      : [tagDataValue[0].value.value];

    console.log("Detected tags:", tags);
    return tags;
  } catch (err) {
    console.error("Error detecting RFID tags:", err);
    return [];
  }
}

module.exports = {
  readRfidTags,
  detectNearbyRfidTags  // 👈 export new function
};
