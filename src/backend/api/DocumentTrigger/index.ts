import { AzureFunction, Context, HttpRequest } from "@azure/functions"
import fs from "fs";
import p from "path"
import * as multipart from "parse-multipart";
const _ = require('lodash')

const documentTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
    try {
        context.log(`DocumentTrigger called with filename: ${req.query.filename}`);
        
        // Validate required parameters
        if (!req.query.filename) {
            context.res = {
                status: 400,
                body: { error: "filename parameter is required" }
            };
            return;
        }

        if (!req.body) {
            context.res = {
                status: 400,
                body: { error: "Request body is required" }
            };
            return;
        }

        if (!req.headers["content-type"]) {
            context.res = {
                status: 400,
                body: { error: "Content-Type header is required" }
            };
            return;
        }

        var body = req.body;
        var boundary = req.headers["content-type"].split("boundary=")[1];

        if (!boundary) {
            context.res = {
                status: 400,
                body: { error: "Invalid multipart content-type, missing boundary" }
            };
            return;
        }

        context.log(`Headers: ${JSON.stringify(req.headers)}`);
        context.log(`Boundary: ${boundary}`);
        
        var parts = multipart.Parse(body, boundary);
        
        if (!parts || parts.length === 0) {
            context.res = {
                status: 400,
                body: { error: "No valid multipart data found" }
            };
            return;
        }

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            context.log(`Processing part ${i}: type=${part.type}, filename=${part.filename}`);
            
            // Clean the filename to ensure it's safe for file system
            let cleanFilename = req.query.filename as string;
            
            // Remove any path traversal attempts and clean the filename
            cleanFilename = cleanFilename.replace(/[<>:"/\\|?*]/g, '_');
            cleanFilename = cleanFilename.replace(/\.\./g, '_');
            
            const fullPath = p.join(process.env.LOCAL_STORAGE_DIR, cleanFilename);
            const split = fullPath.split(p.sep);
            const dir = fullPath.replace(split[split.length - 1], '');
            
            context.log(`Creating directory: ${dir}`);
            context.log(`Writing file to: ${fullPath}`);
            
            // Ensure directory exists
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Write the file (overwrite if exists to handle re-uploads)
            if (part.data && part.data.length > 0) {
                fs.writeFileSync(fullPath, part.data);
                context.log(`Successfully wrote file: ${fullPath}, size: ${part.data.length} bytes`);
            } else {
                context.log(`Warning: Part ${i} has no data or empty data`);
            }
        }
        
        context.res = {
            status: 200,
            body: { 
                message: "File uploaded successfully", 
                filename: req.query.filename,
                partsProcessed: parts.length 
            }
        }
    }
    catch (err) {
        context.log(`Error in DocumentTrigger: ${err.message}`);
        context.log(`Error stack: ${err.stack}`);
        context.res = {
            status: 500,
            body: { 
                error: "Internal server error", 
                message: err.message,
                details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }
        }
    }
};

export default documentTrigger;