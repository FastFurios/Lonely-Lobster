#!/bin/bash
echo "Hello Gerold, welcome to the Lonely Lobster backend!"
code .
PORT=3000
export PORT
nvm use v16.17.0
node target/_main.js --api &