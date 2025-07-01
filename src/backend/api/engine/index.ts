import { BpaConfiguration, BpaStage, BpaServiceObject } from "./types"
import MessageQueue from "../services/messageQueue"
import { DB } from "../services/db"
import { BlobStorage } from "../services/storage"
const _ = require('lodash')

export class BpaEngine {

    constructor() {

    }

    public processAsync = async (serviceObject: BpaServiceObject, stageIndex: number, config: BpaConfiguration, mq : MessageQueue, db : DB): Promise<BpaServiceObject> => {

        return this._process(serviceObject, config, stageIndex, mq, db)

    }

    public processFile = async (blob: BlobStorage, fileBuffer: Buffer, fileName: string, config: BpaConfiguration, mq: MessageQueue, db: DB): Promise<BpaServiceObject> => {
        // Extract clean filename for consistent processing
        let cleanFileName = fileName;

        // Remove path if present (handle both / and \ separators)
        const pathSeparatorIndex = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
        if (pathSeparatorIndex >= 0) {
            cleanFileName = fileName.substring(pathSeparatorIndex + 1);
        }

        // Generate ID from filename (remove extension and sanitize)
        const baseId = cleanFileName.replace(/\.[^/.]+$/, "").replace(/[<>:"/\\|?*]/g, '_');

        console.log(`ENGINE: Processing file: ${fileName} -> cleanFileName: ${cleanFileName} -> ID: ${baseId}`);

        let currentInput: BpaServiceObject = {
            label: "first",
            pipeline: config.name,
            type: this._getFileType(cleanFileName), // Use clean filename for type detection
            filename: cleanFileName, // Store the clean filename
            data: fileBuffer,
            bpaId: "1",
            id: baseId, // Set the filename-based ID here
            aggregatedResults: { "buffer": fileBuffer },
            resultsIndexes: [{ index: 0, name: "buffer", type: this._getFileType(cleanFileName) }],
            vector: []
        }

        if(this._getFileType(fileName).toLowerCase() === 'txt'){
            currentInput.data = currentInput.data.toString()
            currentInput.type = "text"
            currentInput.aggregatedResults["text"] = currentInput.data.toString()
        }

        if(this._getFileType(fileName).toLowerCase() === 'json'){ 
            currentInput.data = JSON.parse(fileBuffer.toString())
            currentInput.type = "json",
            currentInput.aggregatedResults["json"] = JSON.parse(fileBuffer.toString())
        }

        let stageIndex = 1
        return this._process(currentInput, config, stageIndex, mq, db)
    }

    private _process = async (currentInput: BpaServiceObject, config: BpaConfiguration, stageIndex: number, mq : MessageQueue, db: DB) => {
        for (let i = stageIndex; i < config.stages.length + 1; i++) {
            const stage = config.stages[i - 1]
            
            console.log(`STAGE ${stageIndex}: ${stage.service.name}, current ID: ${currentInput.id}, filename: ${currentInput.filename}`);
            
            if (this._validateInput(currentInput.type, stage)) {
                console.log('validation passed')
                currentInput.serviceSpecificConfig = stage.service.serviceSpecificConfig
                const currentOutput: BpaServiceObject = await stage.service.process(currentInput, stageIndex)
                
                // CRITICAL: Always preserve the filename-based ID through all stages
                const originalId = currentInput.id;
                const originalFilename = currentInput.filename;
                currentInput = _.cloneDeep(currentOutput);
                
                // Ensure ID and filename are always preserved
                currentInput.id = originalId;
                currentInput.filename = originalFilename;
                
                console.log(`STAGE ${stageIndex} COMPLETED: ID=${currentInput.id}, filename=${currentInput.filename}`);
                
                if (currentInput.type === 'async transaction') {
                    delete currentInput.aggregatedResults.buffer
                    console.log(`ASYNC: About to store with ID: ${currentInput.id}, filename: ${currentInput.filename}`);
                    const dbout = await db.create(currentInput)
                    await mq.sendMessage({filename: currentInput.filename, id : dbout.id, pipeline : dbout.pipeline, label : dbout.label, type : currentInput.type})
                    break
                }
            }
            else {
                throw new Error(`invalid input type ${JSON.stringify(currentInput.type)} for stage ${stage.service.name}`)
            }
            stageIndex++;
        }

        console.log(`FINAL PROCESS: ID=${currentInput.id}, filename=${currentInput.filename}`);
        return currentInput

    }

    private _validateInput = (input: string, stage: BpaStage): boolean => {
        if (stage.service.name == 'view') {
            return true
        }
        if (stage.service.name == 'changeOutput') {
            return true
        }
        if (stage.service.inputTypes.includes(input)) {
            return true
        }
        return false
    }

    private _getFileType = (fileName: string): string => {
        const fileParts: string[] = fileName.split('.')
        return fileParts[fileParts.length - 1]
    }

}