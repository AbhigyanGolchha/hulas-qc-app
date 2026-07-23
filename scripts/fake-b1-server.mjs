// Minimal fake SAP B1 Service Layer for connector smoke-testing.
import http from 'http';

const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const ok = (code, obj, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/b1s/v1/Login' && req.method === 'POST') {
      const creds = JSON.parse(body || '{}');
      if (creds.UserName !== 'hulas_tech' || creds.Password !== 'secret' || creds.CompanyDB !== 'HULAS_TEST') {
        return ok(401, { error: { message: { value: 'Invalid credentials' } } });
      }
      return ok(200, { SessionId: 'fake-session' }, { 'Set-Cookie': 'B1SESSION=fake-session; path=/' });
    }
    if (!String(req.headers.cookie || '').includes('B1SESSION=fake-session')) {
      return ok(401, { error: { message: { value: 'Session missing' } } });
    }
    if (req.url.startsWith('/b1s/v1/HULAS_QC') && req.method === 'GET') {
      return ok(200, { value: [] });
    }
    if (req.url === '/b1s/v1/HULAS_QC' && req.method === 'POST') {
      const row = JSON.parse(body);
      if (seen.includes(row.Code)) return ok(400, { error: { code: -2035, message: { value: 'This entry already exists' } } });
      seen.push(row.Code);
      console.log('UDO row created:', row.Code, row.U_RecType, 'result=' + row.U_Result);
      return ok(201, { Code: row.Code, Name: row.Name });
    }
    if (req.url.startsWith('/b1s/v1/HULAS_QC(') && req.method === 'PATCH') {
      console.log('UDO row updated:', decodeURIComponent(req.url));
      return ok(204, {});
    }
    if (req.url === '/b1s/v1/InventoryGenExits' && req.method === 'POST') {
      const doc = JSON.parse(body);
      console.log('Issue for Production:', doc.DocumentLines.length, 'lines, BaseEntry', doc.DocumentLines[0]?.BaseEntry);
      return ok(201, { DocEntry: 501, DocNum: 9501 });
    }
    if (req.url === '/b1s/v1/InventoryGenEntries' && req.method === 'POST') {
      const doc = JSON.parse(body);
      console.log('Receipt from Production:', doc.DocumentLines.map((l) => `${l.ItemCode}:${l.Quantity}kg batch=${l.BatchNumbers?.[0]?.BatchNumber ?? '-'}`).join(' | '));
      return ok(201, { DocEntry: 502, DocNum: 9502 });
    }
    ok(404, { error: { message: { value: 'Not found: ' + req.url } } });
  });
});
server.listen(5999, () => console.log('fake B1 Service Layer on :5999'));
