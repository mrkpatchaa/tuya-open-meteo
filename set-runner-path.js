import { writeFileSync } from "fs";

const runnerPath = "./runner.sh";
const indexPath = `${process.cwd()}/index.ts`;

writeFileSync(
  runnerPath,
  `#!/bin/sh
node ${indexPath}
`
);

console.log(`Updated runner.sh INDEX_PATH to ${indexPath}`);
