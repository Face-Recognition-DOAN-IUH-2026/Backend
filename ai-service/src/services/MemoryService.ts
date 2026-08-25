import { AppDataSource } from '../data-source';
import { AiMemory } from '../entities/AiMemory';

const memoryRepo = () => AppDataSource.getRepository(AiMemory);

export class MemoryService {
  async getMemoriesForPatron(patronId: string): Promise<Record<string, string>> {
    const memories = await memoryRepo().find({
      where: { patronId },
    });

    const result: Record<string, string> = {};
    for (const memory of memories) {
      result[memory.memoryKey] = memory.memoryValue;
    }
    return result;
  }

  async saveMemoryForPatron(patronId: string, key: string, value: string): Promise<void> {
    const existing = await memoryRepo().findOne({
      where: { patronId, memoryKey: key },
    });

    if (existing) {
      existing.memoryValue = value;
      existing.updatedAt = new Date();
      await memoryRepo().save(existing);
    } else {
      const memory = memoryRepo().create({
        patronId,
        memoryKey: key,
        memoryValue: value,
      });
      await memoryRepo().save(memory);
    }
  }

  async consolidateNewMemories(patronId: string, chatHistory: Array<{ role: string; content: string }>): Promise<void> {
    if (!chatHistory || chatHistory.length === 0) {
      return;
    }

    const memoriesToSave = this.extractMemoriesFromChat(chatHistory);

    for (const [key, value] of Object.entries(memoriesToSave)) {
      await this.saveMemoryForPatron(patronId, key, value);
    }
  }

  async deleteMemoryForPatron(patronId: string, key: string): Promise<void> {
    await memoryRepo().delete({
      patronId,
      memoryKey: key,
    });
  }

  private extractMemoriesFromChat(chatHistory: Array<{ role: string; content: string }>): Record<string, string> {
    const memories: Record<string, string> = {};

    for (const message of chatHistory) {
      if (message.role !== 'user') continue;

      const content = message.content.toLowerCase();

      if (content.includes('thích') || content.includes(' yêu thích') || content.includes('thể loại')) {
        memories['preference'] = message.content;
      }

      if (content.includes('tên tôi là') || content.includes('tôi tên')) {
        const nameMatch = message.content.match(/(?:tên tôi là|tôi tên)\s+([A-Za-zÀ-ỹ\s]+)/i);
        if (nameMatch) {
          memories['user_name'] = nameMatch[1].trim();
        }
      }

      if (content.includes('mượn') || content.includes('sách')) {
        memories['recent_topic'] = 'book_borrowing';
      }
    }

    return memories;
  }
}
