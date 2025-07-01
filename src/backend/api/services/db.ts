import { CosmosClient } from "@azure/cosmos"
import { MongoClient } from 'mongodb'
import { BpaPipelines, BpaServiceObject } from "../engine/types"
import { v4 as uuidv4 } from 'uuid';
import { BlobStorage } from "./storage";
const redis = require("redis")

export abstract class DB {

    protected _connectionString: string
    protected _dbName: string
    protected _containerName: string
    protected _pipelinesLabel: string

    constructor(connectionString: string, dbName: string, containerName: string) {
        this._connectionString = connectionString
        this._dbName = dbName
        this._containerName = containerName
        this._pipelinesLabel = "pipelines"
    }

    public abstract create(data): Promise<any>;
    // public abstract view(input: BpaServiceObject): Promise<any>
    public abstract getConfig(): Promise<BpaPipelines>
    public abstract getByID(id: string, pipeline: string): Promise<any>
    public abstract deleteByID(id: string): Promise<any>
}

export class BlobDB extends DB {

    //private _client: BlobStorage
    private _configClient : BlobStorage
    private _resultsClient : BlobStorage

    constructor(connectionString: string, dbName: string, containerName: string) {
        super(connectionString, dbName, containerName)
        this._configClient = new BlobStorage(connectionString, 'config')
        this._resultsClient = new BlobStorage(connectionString, 'results')
    }

    private generateUniqueId = async (data: any): Promise<string> => {
        console.log(`generateUniqueId called with data:`, JSON.stringify({
            id: data.id,
            filename: data.filename,
            pipeline: data.pipeline,
            hasFilename: !!data.filename,
            allKeys: Object.keys(data)
        }))
        
        if (data.id) {
            console.log(`Using existing ID: ${data.id}`)
            return data.id
        }
        
        // Try multiple sources for filename
        let filename = data.filename || data.fileName || data.name
        
        if (filename) {
            // Extract just the filename without path and extension
            
            // Remove path if present (handle both / and \ separators)
            const pathSeparatorIndex = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
            if (pathSeparatorIndex >= 0) {
                filename = filename.substring(pathSeparatorIndex + 1)
            }
            
            // Remove file extension but keep the original name structure
            let baseId = filename.replace(/\.[^/.]+$/, "")
            
            // Only replace problematic characters, keep original name readable
            baseId = baseId.replace(/[<>:"/\\|?*]/g, '_')
            
            console.log(`Using filename-based ID: ${baseId}`)
            return baseId
        }
        
        console.log(`No filename found, using UUID`)
        return uuidv4()
    }

    public connect = async () => {
        //await this._client.connect()
    }

    private getFilenameBasedId = (data: any): string => {
        if (!data.filename) {
            throw new Error("Filename is required for ID generation");
        }
        
        let filename = data.filename;
        
        // Remove path if present (handle both / and \ separators)
        const pathSeparatorIndex = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
        if (pathSeparatorIndex >= 0) {
            filename = filename.substring(pathSeparatorIndex + 1);
        }
        
        // Remove file extension but keep original name readable
        const baseId = filename.replace(/\.[^/.]+$/, "");
        
        // Only replace problematic characters for storage
        return baseId.replace(/[<>:"/\\|?*]/g, '_');
    }

    public create = async (data: any): Promise<any> => {
        // Always use filename-based ID generation
        const id = this.getFilenameBasedId(data);
        data.id = id;
        
        console.log(`BlobDB storing with filename-based ID: ${id}, original filename: ${data.filename}`);
        
        // Store with pipeline prefix to maintain organization
        const storagePath = data.pipeline ? `${data.pipeline}/${id}.json` : `${id}.json`;
        await this._resultsClient.upload(Buffer.from(JSON.stringify(data)), storagePath);

        return data;
    }

    public createError = async (data: any): Promise<any> => {
        if(data?.aggregatedResults?.buffer){
            delete data.aggregatedResults.buffer;
        }
        
        // Use filename-based ID for error files too
        const baseId = data.filename ? this.getFilenameBasedId(data) : `error_${new Date().getTime()}`;
        const errorFileName = `${baseId}_error.json`;
        
        await this._resultsClient.upload(Buffer.from(JSON.stringify(data)), `error/${data.pipeline}/${errorFileName}`);

        return data;
    }

    public getConfig = async (): Promise<BpaPipelines> => {

        return JSON.parse((await this._configClient.getBuffer('pipelines.json')).toString())
    }
    public getByID = async (id: string, pipeline: string): Promise<any> => {
        const filePath = pipeline ? `${pipeline}/${id}.json` : `${id}.json`;
        return JSON.parse((await this._resultsClient.getBuffer(filePath)).toString())
    }
    
    public getByOriginalFilename = async (filename: string, pipeline: string): Promise<any> => {
        const id = this.getFilenameBasedId({ filename });
        const filePath = `${pipeline}/${id}.json`;
        return JSON.parse((await this._resultsClient.getBuffer(filePath)).toString())
    }

    public getByFilename = async (filename: string): Promise<any> => {
        // For backward compatibility, try to get file by original filename structure
        try {
            return JSON.parse((await this._resultsClient.getBuffer(filename)).toString())
        } catch (error) {
            // If not found, try with the new filename-based structure
            const id = filename.replace(/\.[^/.]+$/, "")
            const pipeline = filename.split('/')[0] // Assuming pipeline is the first part of the path
            return JSON.parse((await this._resultsClient.getBuffer(`${pipeline}/${id}.json`)).toString())
        }
    }
    
    public deleteByID = async (id: string): Promise<any> => {
        this._resultsClient.delete(id)
        return null
    }

}


export class Redis extends DB {

    private _client

    constructor(connectionString: string, dbName: string, containerName: string) {
        super(connectionString, dbName, containerName)
        const options = {
            url: connectionString,
            password: dbName,
        }
        this._client = redis.createClient(options)
    }

    public connect = async () => {
        await this._client.connect()
    }

    public create = async (data: any): Promise<any> => {
        let id: string
        if (data.id) {
            id = data.id
        } else if (data.filename) {
            // Use original filename without extension for Redis too
            let filename = data.filename
            
            // Remove path if present
            const pathSeparatorIndex = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
            if (pathSeparatorIndex >= 0) {
                filename = filename.substring(pathSeparatorIndex + 1)
            }
            
            // Remove file extension and sanitize
            id = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, '_')
            data.id = id
        } else {
            id = uuidv4()
            data.id = id
        }
        
        console.log(`Redis storing with ID: ${id}, original filename: ${data.filename}`)
        const out = await this._client.set(id, data)

        return
    }
    public view = async (input: BpaServiceObject): Promise<BpaServiceObject> => {
        await this.create(input)
        return input
    }
    public getConfig = async (): Promise<BpaPipelines> => {
        try {
            const out = await this._client.get(this._pipelinesLabel)

            return out
        } catch (err) {
            console.log(err)
        }
        return null
    }
    public getByID = async (id: string, pipeline: string): Promise<any> => {
        try {
            const out = await this._client.get(id)

            return out
        } catch (err) {
            console.log(err)
        }
        return null
    }
    public deleteByID = async (id: string): Promise<any> => {
        const out = await this._client.set(id, null)

        return out
    }

}

export class MongoDB extends DB {
    public getByID(id: string): Promise<any> {
        throw new Error("Method not implemented.")
    }
    public deleteByID(id: string): Promise<any> {
        throw new Error("Method not implemented.")
    }
    private _mongoClient: MongoClient

    constructor(connectionString: string, dbName: string, containerName: string) {
        super(connectionString, dbName, containerName)
        this._mongoClient = new MongoClient(connectionString)
    }

    public create = async (data): Promise<any> => {
        try {
            await this._mongoClient.connect()
            const db = this._mongoClient.db(this._dbName)
            const collection = db.collection(this._containerName)
            const insertResult = await collection.insertOne(data)

            return insertResult
        } catch (err) {
            console.log(err)
        } finally {
            this._mongoClient.close()
        }
        return null
    }

    public view = async (input: BpaServiceObject): Promise<BpaServiceObject> => {
        await this.create(input)
        return input
    }

    public getConfig = async (): Promise<any> => {
        try {
            await this._mongoClient.connect()
            const db = this._mongoClient.db(this._dbName)
            const collection = db.collection(this._containerName)
            const item = await collection.findOne({ _id: this._pipelinesLabel })
            return item as any
        } catch (err) {
            console.log(err)
        } finally {
            this._mongoClient.close()
        }
        return null
    }


}


export class CosmosDB extends DB {

    constructor(connectionString: string | undefined, dbName: string | undefined, containerName: string | undefined) {
        super(connectionString, dbName, containerName)

    }

    public create = async (data): Promise<any> => {

        const client = new CosmosClient(this._connectionString);
        //console.log(`db: ${this._dbName}`)
        const database = client.database(this._dbName);
        const container = database.container(this._containerName);
        //console.log(`container: ${this._containerName}`)
        const { resource: createdItem } = await container.items.upsert(data);
        return createdItem

    }

    public view = async (input: BpaServiceObject): Promise<any> => {
        const newItem = await this.create(input)

        return newItem
    }

    public getConfig = async (): Promise<BpaPipelines> => {

        const client = new CosmosClient(this._connectionString);
        const database = client.database(this._dbName);
        const container = database.container(this._containerName);
        const item = await container.item(this._pipelinesLabel).read()
        return item.resource

    }

    public getByID = async (id: string, pipeline: string): Promise<any> => {

        const client = new CosmosClient(this._connectionString);
        const database = client.database(this._dbName);
        const container = database.container(this._containerName);
        const item = await container.item(id).read()
        return item.resource

    }

    public deleteByID = async (id: string): Promise<any> => {

        const client = new CosmosClient(this._connectionString);
        const database = client.database(this._dbName);
        const container = database.container(this._containerName);
        const item = await container.item(id).delete();
        return item.resource

    }
}