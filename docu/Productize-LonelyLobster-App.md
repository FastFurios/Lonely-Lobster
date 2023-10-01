# Lonely Lobster Productization

## Frontend
Angular deploy onto Azure Web App: 
- Azure Linux Server: https://www.youtube.com/watch?v=FW2-_ce_eNc Rating: +++ 
- Azure Windows Server: https://www.youtube.com/watch?v=YMw5YmZRiI0  Rating: +++ 


## Backend
### Express Sessions
- express-session https://www.youtube.com/watch?v=IPAvfcodcI8  Rating: +++
- https://www.pluralsight.com/courses/nodejs-express-web-applications-update?utm_source=google&utm_medium=paid-search&utm_campaign=upskilling-and-reskilling&utm_term=b2b-emea-dynamic&gclid=CjwKCAjwxaanBhBQEiwA84TVXITGaSBNCdnte95ONl9xn3sHZKsKLeAahIfe41twDJqYl5IWURQu5BoCBh4QAvD_BwE

### Lonely Lobster backend code
- prepare for supporting multiple parallel user sessions, i.e. multiple parallel instances of the Lonely Lobster Systems and it's attached components e.g. Output Basket  


## Battle Plan
1. Prepartional work
    1. on Playground, try out express sessions with a super simple html frontend
    2. See if the backend can also be deployed to Azure Web App or whether I need to setup a separate backend service 
2. Deploy the Lonely Lobster Angular frontend on localhost
3. Integrate "express-sessions" into the Lonely Lobster backend
4. Call the (single) session-ready LonelyLobster backend on localhost from the locally deployed Angular dist    
5. Deploy the Angular frontend to Azure
6. Deploy the backend to Azure and call from the Azure frontend   
7. Modify the backend code to support multiple simultaneous sessions in the one Lonely Lobster node.js instance 

