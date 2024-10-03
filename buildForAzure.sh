#!/bin/bash

echo ">>> LONELY LOBSTER: BUILD FOR AZURE <<<"

echo ">>> Cleaning build & deploy stage ..."
rm -r ~/sw-projects/azure/Lonely-Lobster/frontend/*
rm -r ~/sw-projects/azure/Lonely-Lobster/target/*
rm ~/sw-projects/azure/Lonely-Lobster/package.json
rm ~/sw-projects/azure/Lonely-Lobster/package-lock.json
rm ~/sw-projects/azure/Lonely-Lobster/* > /dev/null 2> /dev/null

echo ">>> BACKEND: copying artifacts to build & deploy stage ..."
cp ~/sw-projects/Lonely-Lobster/target/*.js ~/sw-projects/azure/Lonely-Lobster/target/
rm -r ~/sw-projects/azure/Lonely-Lobster/target/__*
cp ~/sw-projects/Lonely-Lobster/package.json ~/sw-projects/azure/Lonely-Lobster/
cp ~/sw-projects/Lonely-Lobster/package-lock.json ~/sw-projects/azure/Lonely-Lobster/

echo ">>> FRONTEND: creating artifacts and copying to build & deploy stage ..."

cp -r ~/sw-projects/Angular-Testbed/dist/lonely-lobster/* ~/sw-projects/azure/Lonely-Lobster/frontend
echo ">>> Now, please deploy via VSCode to the Azure Web App!"
