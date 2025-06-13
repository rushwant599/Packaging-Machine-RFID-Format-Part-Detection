# Format-RFIDParts
A web-based interface designed to visualize and manage RFID-tagged machine components in a machine. This portal enables technicians and engineers to assign RFID tags to machine format parts and validate configuration status before production begins.




**FEATURES**

Read RFID Tags: Detect all active RFID tags from connected antennas.

Assign Tags to Format Parts: Use a dropdown menu to link format parts with available RFID tags.

Visual Validation: Automatically marks format parts that are successfully assigned. A master checkbox confirms complete configuration.

Multilingual Support: Switch between German, Czech, Spanish, French, Italian, and English.

Somic-branded Interface: Integrates official branding and styling for customer delivery.


This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## To test the html in docker use the provided dockerfile for a simple webserver.

### Build and Deploy locally
Build the container with: 
```docker build -t test .```

Start the container with:
```docker run -d -p 8080:3000 test```

You should now be able to access the Editor/HTML in your browser via: http://localhost:8080


### Use nodeJS
First install dependencies locally:
```npm install express```
```npm install --save-dev nodemon```
To start the server:
```npm start```
To start the Dev server:
```npm run dev```

