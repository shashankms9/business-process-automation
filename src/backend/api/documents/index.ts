import { AzureFunction, Context, HttpRequest } from "@azure/functions"
import HTTP_CODES from "http-status-enum";
import * as multipart from "parse-multipart";
import axios, { AxiosRequestConfig, AxiosRequestHeaders } from "axios";

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<any> {

    if (process.env.USE_LOCAL_STORAGE === 'true') {
        try{
            context.log("uploading via local storage from frontend")
            
            // Extract clean filename for consistent processing
            let cleanFilename = req.query.filename;
            if (cleanFilename) {
                // Remove path if present and sanitize
                const pathSeparatorIndex = Math.max(cleanFilename.lastIndexOf('/'), cleanFilename.lastIndexOf('\\'))
                if (pathSeparatorIndex >= 0) {
                    cleanFilename = cleanFilename.substring(pathSeparatorIndex + 1)
                }
                // Only replace problematic characters
                cleanFilename = cleanFilename.replace(/[<>:"/\\|?*]/g, '_')
            }
            
            const headers : AxiosRequestHeaders = {
                "content-type" : req.headers["content-type"]
            }
            const options : AxiosRequestConfig = {
               headers : headers 
            }
            context.log(`Processing file: ${req.query.filename} -> cleaned: ${cleanFilename}`)
            
            const out = await axios.post(`http://${process.env.BACKEND_HOST}:${process.env.BACKEND_PORT}/api/DocumentTrigger?filename=${cleanFilename}`, req.body, options)
            
            context.res = {
                status: 200,
                body: {
                    status: "success",
                    filename: cleanFilename, // Return the cleaned filename
                    originalFilename: req.query.filename,
                    out: out.status
                }
            }
            return
        }catch(error){
            context.log(error)
            context.res = {
                status: 500,
                body: {
                    status: "error",
                    filename: req.query.filename,
                    out: error
                }
            }
        }
        return
    } else {
        context.log('upload HTTP trigger function processed a request.');

        //`filename` is required property to use multi-part npm package
        if (!req.query?.filename) {
            context.res.body = `filename is not defined`;
            context.res.status = HTTP_CODES.BAD_REQUEST
            return context.res;
        }

        if (!req.body || !req.body.length) {
            context.res.body = `Request body is not defined`;
            context.res.status = HTTP_CODES.BAD_REQUEST
            return context.res;
        }

        // Content type is required to know how to parse multi-part form
        if (!req.headers || !req.headers["content-type"]) {
            context.res.body = `Content type is not sent in header 'content-type'`;
            context.res.status = HTTP_CODES.BAD_REQUEST
            return context.res;
        }

        // Extract and clean the filename for consistent processing
        let cleanFilename = req.query.filename as string;
        const pathSeparatorIndex = Math.max(cleanFilename.lastIndexOf('/'), cleanFilename.lastIndexOf('\\'))
        if (pathSeparatorIndex >= 0) {
            cleanFilename = cleanFilename.substring(pathSeparatorIndex + 1)
        }
        // Only replace problematic characters for storage
        cleanFilename = cleanFilename.replace(/[<>:"/\\|?*]/g, '_')

        context.log(`Processing upload - Original: ${req.query.filename}, Cleaned: ${cleanFilename}, Content type: ${req.headers["content-type"]}, Length: ${req.body.length}`);

        if (process?.env?.Environment === 'Production' && (!process?.env?.AzureWebJobsStorage || process?.env?.AzureWebJobsStorage.length < 10)) {
            throw Error("Storage isn't configured correctly - get Storage Connection string from Azure portal");
        }

        try {
            // Each chunk of the file is delimited by a special string
            const bodyBuffer = Buffer.from(req.body);
            const boundary = multipart.getBoundary(req.headers["content-type"]);
            const parts = multipart.Parse(bodyBuffer, boundary);

            // The file buffer is corrupted or incomplete ?
            if (!parts?.length) {
                context.res.body = `File buffer is incorrect`;
                context.res.status = HTTP_CODES.BAD_REQUEST
                return context.res;
            }

            // Log original filename information but use our cleaned filename
            if (parts[0]?.filename) context.log(`Multipart original filename = ${parts[0]?.filename}`);
            if (parts[0]?.type) context.log(`Content type = ${parts[0]?.type}`);
            if (parts[0]?.data?.length) context.log(`Size = ${parts[0]?.data?.length}`);

            context.log(`UPLOAD: Using cleaned filename for storage: ${cleanFilename}`);

            // CRITICAL: Store the file with the cleaned filename
            context.bindings.storage = parts[0]?.data;

            // Return the cleaned filename path for consistency
            context.res.body = `${process.env.BLOB_STORAGE_CONTAINER}/${cleanFilename}`;
        } catch (err) {
            context.log.error(err.message);
            context.res.body = `${err.message}`;
            context.res.status = HTTP_CODES.INTERNAL_SERVER_ERROR
        }
        return context.res;
    }

};

export default httpTrigger;