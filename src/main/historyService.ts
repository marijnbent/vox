import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import { logger } from './logger';

export interface HistoryRecord {
  id: string;
  timestamp: number;
  originalText: string;
  enhancedText: string | null;
  promptChainUsed?: string[] | null; // New field to store the chain of prompts used
  promptDetails?: { promptId: string; promptName: string; renderedPrompt: string; enhancedText: string; }[]; // New field for detailed prompt information
}

export interface PaginatedHistory {
  entries: HistoryRecord[];
  totalEntries: number;
  totalPages: number;
  currentPage: number;
}

const dbPath = path.join(app.getPath('userData'), 'transcription_history.db');
let db: Database.Database;

try {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info(`Created database directory: ${dbDir}`);
    }
} catch (error) {
    logger.error('Failed to create database directory:', error);
}

try {
    db = new Database(dbPath, { verbose: logger.debug });
    logger.info(`Database initialized at: ${dbPath}`);
} catch (error) {
    logger.error('Failed to initialize database:', error);
}

// Removed unused fields from the history table schema and ensured promptDetails is always an array.
function initializeSchema(): void {
    if (!db) return;
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                originalText TEXT NOT NULL,
                enhancedText TEXT
            );
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history (timestamp);`);

        db.exec(`
            CREATE TABLE IF NOT EXISTS prompt_details (
                historyId TEXT NOT NULL,
                promptId TEXT NOT NULL,
                promptName TEXT NOT NULL,
                renderedPrompt TEXT,
                enhancedText TEXT,
                PRIMARY KEY (historyId, promptId),
                FOREIGN KEY (historyId) REFERENCES history(id) ON DELETE CASCADE
            );
        `);

        logger.info('Database schema initialized successfully.');
    } catch (error) {
        logger.error('Failed to initialize database schema:', error);
    }
}

initializeSchema();

export function addHistoryEntry(entry: Omit<HistoryRecord, 'id' | 'timestamp'> & { promptDetails: { promptId: string; promptName: string; renderedPrompt: string; enhancedText: string; }[] }): void {
    if (!db) return;

    const timestamp = Date.now();
    const id = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

    const promptDetails = entry.promptDetails || []; // Ensure promptDetails is always an array

    const insertHistoryStmt = db.prepare(`
        INSERT INTO history (id, timestamp, originalText, enhancedText)
        VALUES (?, ?, ?, ?)
    `);

    const insertPromptDetailsStmt = db.prepare(`
        INSERT INTO prompt_details (historyId, promptId, promptName, renderedPrompt, enhancedText)
        VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
        insertHistoryStmt.run(id, timestamp, entry.originalText, entry.enhancedText);

        for (const detail of promptDetails) {
            insertPromptDetailsStmt.run(id, detail.promptId, detail.promptName, detail.renderedPrompt, detail.enhancedText);
        }
    });

    try {
        transaction();
        logger.info(`History entry added with ID: ${id}`);
    } catch (error) {
        logger.error('Failed to add history entry:', error);
    }
}

export function getHistoryEntries(page = 1, pageSize = 10): PaginatedHistory | null {
    if (!db) return null;

    const offset = (page - 1) * pageSize;

    const historyStmt = db.prepare(`
        SELECT id, timestamp, originalText, enhancedText
        FROM history
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    `);

    const promptDetailsStmt = db.prepare(`
        SELECT promptId, promptName, renderedPrompt, enhancedText
        FROM prompt_details
        WHERE historyId = ?
    `);

    try {
        const entries = historyStmt.all(pageSize, offset).map((history: any) => {
            const details = promptDetailsStmt.all(history.id);
            return {
                ...history,
                promptDetails: details
            };
        });

        const totalEntries = db.prepare('SELECT COUNT(*) AS count FROM history').get().count;
        const totalPages = Math.ceil(totalEntries / pageSize);

        return {
            entries,
            totalEntries,
            totalPages,
            currentPage: page
        };
    } catch (error) {
        logger.error('Failed to fetch history entries:', error);
        return null;
    }
}

export function deleteHistoryEntry(id: string): boolean {
     if (!db) {
        logger.error('Cannot delete history entry: Database not initialized.');
        return false;
    }
    const sql = 'DELETE FROM history WHERE id = ?';
    try {
        const stmt = db.prepare(sql);
        const result = stmt.run(id);
        logger.info(`Deleted history entry ${id}. Changes: ${result.changes}`);
        return result.changes > 0;
    } catch (error) {
        logger.error(`Failed to delete history entry ${id}:`, error);
        return false;
    }
}

export function clearAllHistory(): boolean {
     if (!db) {
        logger.error('Cannot clear history: Database not initialized.');
        return false;
    }
    const sql = 'DELETE FROM history';
    try {
        const stmt = db.prepare(sql);
        const result = stmt.run();
        logger.info(`Cleared all history entries. Changes: ${result.changes}`);
        return true;
    } catch (error) {
        logger.error('Failed to clear history:', error);
        return false;
    }
}

app.on('before-quit', () => {
    if (db && db.open) {
        logger.info('Closing database connection.');
        db.close();
    }
});
