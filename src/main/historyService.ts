import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import { logger } from './logger';
import store, { type EnhancementPrompt } from './store';

export interface HistoryRecord {
  id: string;
  timestamp: number;
  originalText: string;
  renderedPrompt: string | null;
  enhancedText: string | null;
  promptIdUsed: string | null;
  promptNameUsed?: string | null;
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

function initializeSchema(): void {
    if (!db) return;
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                originalText TEXT NOT NULL,
                renderedPrompt TEXT,
                enhancedText TEXT,
                promptIdUsed TEXT
            );
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history (timestamp);`);

        const columns = db.pragma('table_info(history)');
        const hasRenderedPrompt = columns.some((col: any) => col.name === 'renderedPrompt');
        if (!hasRenderedPrompt) {
            db.exec('ALTER TABLE history ADD COLUMN renderedPrompt TEXT;');
            logger.info('Added renderedPrompt column to history table.');
        }

        logger.info('Database schema initialized successfully.');
    } catch (error) {
        logger.error('Failed to initialize database schema:', error);
    }
}

initializeSchema();

export function addHistoryEntry(entry: Omit<HistoryRecord, 'id' | 'timestamp'>): void {
    if (!db) {
        logger.error('Cannot add history entry: Database not initialized.');
        return;
    }
    const timestamp = Date.now();
    const id = `${timestamp}-${Math.random().toString(36).substring(2, 8)}`;
    const sql = `
        INSERT INTO history (id, timestamp, originalText, renderedPrompt, enhancedText, promptIdUsed)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    try {
        const stmt = db.prepare(sql);
        stmt.run(
            id,
            timestamp,
            entry.originalText,
            entry.renderedPrompt ?? null,
            entry.enhancedText ?? null,
            entry.promptIdUsed ?? null
        );
        logger.info(`Added history entry: ${id}`);
    } catch (error) {
        logger.error('Failed to add history entry:', error);
    }
}

export function getHistoryEntries(page = 1, pageSize = 10): PaginatedHistory | null {
     if (!db) {
        logger.error('Cannot get history entries: Database not initialized.');
        return null;
    }
    try {
        const countResult = db.prepare('SELECT COUNT(*) as count FROM history').get() as { count: number };
        const totalEntries = countResult.count;
        const totalPages = Math.ceil(totalEntries / pageSize);
        const currentPage = Math.max(1, Math.min(page, totalPages));
        const offset = (currentPage - 1) * pageSize;

        const sql = `
            SELECT * FROM history
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        `;
        const stmt = db.prepare(sql);
        let entries = stmt.all(pageSize, offset) as HistoryRecord[];

        const prompts = store.get('enhancementPrompts', []) as EnhancementPrompt[];
        const promptMap = new Map(prompts.map(p => [p.id, p.name]));

        entries = entries.map(entry => {
            let promptName: string | null = null;
            if (entry.promptIdUsed === 'default') {
                promptName = 'Default Prompt';
            } else if (entry.promptIdUsed) {
                promptName = promptMap.get(entry.promptIdUsed) ?? 'Deleted Prompt';
            }
            return { ...entry, promptNameUsed: promptName };
        });

        logger.info(`Fetched history page ${currentPage}/${totalPages} (${entries.length} entries with prompt names)`);

        return {
            entries,
            totalEntries,
            totalPages,
            currentPage,
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
