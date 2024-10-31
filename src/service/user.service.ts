import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

export const getOrCreateUser = async (telegramId: string, username: string = "unknown") => {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.telegramId, telegramId),
        });
        
        if (user) {
            return user;
        } else {
            const newUsers = await db.insert(users).values({
                username: username,
                telegramId,
            }).returning().execute();
            
            if (!newUsers) {
                return null;
            }
            
            return newUsers[0];
        }
    } catch (error) {
        console.error('Error during user creation:', error);
    }
};