// The sandbox launcher keeps its stable suite path; adapter fixtures stay with the connector.
import {connectorTestURL} from './helpers/connector-fixtures.mjs';
await import(connectorTestURL('trial-isolation.suite.mjs'));
