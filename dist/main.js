import { runCli } from './cli.js';
runCli(process.argv.slice(2), { env: process.env, log: (line) => console.log(line) }).then((code) => {
    process.exitCode = code;
}, (error) => {
    console.error(error);
    process.exitCode = 1;
});
