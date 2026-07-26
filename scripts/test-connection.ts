/* eslint-disable no-console */
// read-only: logs into the Service Layer and checks the QC endpoint is reachable
import { testConnection } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

async function main() {
  console.log(await testConnection());
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
