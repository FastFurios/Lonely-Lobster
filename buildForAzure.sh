#!/bin/bash

echo ">>> LONELY LOBSTER: BUILD FOR AZURE <<<"

echo ">>> Cleaning build & deploy stage ..."
rm -r ~/sw_projects/azure/Lonely-Lobster/frontend/*
rm -r ~/sw_projects/azure/Lonely-Lobster/target/*
rm ~/sw_projects/azure/Lonely-Lobster/package.json
rm ~/sw_projects/azure/Lonely-Lobster/package-lock.json
rm ~/sw_projects/azure/Lonely-Lobster/* > /dev/null 2> /dev/null

echo ">>> BACKEND: copying artifacts to build & deploy stage ..."
cp ~/sw_projects/Lonely-Lobster/target/*.js ~/sw_projects/azure/Lonely-Lobster/target/
rm -r ~/sw_projects/azure/Lonely-Lobster/target/__*
cp ~/sw_projects/Lonely-Lobster/package.json ~/sw_projects/azure/Lonely-Lobster/
cp ~/sw_projects/Lonely-Lobster/package-lock.json ~/sw_projects/azure/Lonely-Lobster/

echo ">>> FRONTEND: creating artifacts and copying to build & deploy stage ..."

cp -r ~/sw_projects/Angular-Testbed/dist/my-first-project/* ~/sw_projects/azure/Lonely-Lobster/frontend
echo ">>> Now, please deploy via VSCode to the Azure Web App!"
