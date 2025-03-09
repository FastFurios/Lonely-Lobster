#!/bin/bash

echo ">> git add, commit and push orgin w/o secrets:"
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 \"<your git commit message>\""
    exit 1
fi

COMMIT_MSG=$1
FILE="./src/environment.ts"
FILE_HIDE="${FILE}.hide"
echo "File is $FILE"

SEARCH_TENANT="49bf30a4-54b2-47ae-b9b1-ffa71ed3d475"
SEARCH_APPLICATION="5797aa9c-0703-46d9-9fba-934498b8e5d6"

REPLACEMENT_TENANT="<use your own Azure tenant>"
REPLACEMENT_APPLICATION="<use your own Azure application ID for the backend>"

# cp original environment files aside for later restoring
cp $FILE $FILE_HIDE

# replace my Azure tenant's references
sed -i "s/${SEARCH_TENANT}/${REPLACEMENT_TENANT}/g" "$FILE"
sed -i "s/${SEARCH_APPLICATION}/${REPLACEMENT_APPLICATION}/g" "$FILE"

git add .
git status
git commit -m "$1"
git push origin

cp $FILE_HIDE $FILE  

echo ">> Push to origin done."