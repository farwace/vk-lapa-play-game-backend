import { AccessToken, RoomServiceClient, Room as LiveKitRoom } from 'livekit-server-sdk';

class LiveKitService {
    private roomService: RoomServiceClient;
    private apiUrl: string;
    private apiKey: string;
    private apiSecret: string;

    constructor() {
        this.apiUrl = process.env.LIVEKIT_API_URL || '';
        this.apiKey = process.env.LIVEKIT_API_KEY || '';
        this.apiSecret = process.env.LIVEKIT_API_SECRET || '';

        if (!this.apiUrl || !this.apiKey || !this.apiSecret) {
            throw new Error('LiveKit configuration is missing in environment variables');
        }

        this.roomService = new RoomServiceClient(this.apiUrl, this.apiKey, this.apiSecret);
    }

    /**
     * Создает голосовую комнату в LiveKit
     */
    async createVoiceRoom(roomId: string): Promise<LiveKitRoom> {
        try {
            const room = await this.roomService.createRoom({
                name: `voice-${roomId}`,
                emptyTimeout: 300, // 5 минут до удаления пустой комнаты
                maxParticipants: 12,
            });
            return room;
        } catch (error) {
            console.error('Failed to create LiveKit room:', error);
            throw error;
        }
    }

    /**
     * Генерирует токен для подключения к голосовой комнате
     */
    generateAccessToken(
        roomId: string,
        playerId: string,
        playerName: string,
        canSpeak: boolean = true
    ): Promise<string> {
        const token = new AccessToken(this.apiKey, this.apiSecret, {
            identity: playerId,
            name: playerName,
        });

        token.addGrant({
            roomJoin: true,
            room: `voice-${roomId}`,
            canPublish: canSpeak,
            canSubscribe: true,
            canPublishData: true,
        });

        return token.toJwt();
    }

    /**
     * Обновляет разрешения участника в комнате
     */
    async updateParticipantPermissions(
        roomId: string,
        playerId: string,
        canSpeak: boolean
    ): Promise<void> {
        try {
            const participant = await this.roomService.getParticipant(`voice-${roomId}`, playerId);
            participant.tracks.forEach((track) => {
                this.roomService.mutePublishedTrack(`voice-${roomId}`, playerId, track.sid, !canSpeak);
            });

            // await this.roomService.updateParticipant(`voice-${roomId}`, playerId, {
            //     permission: {
            //         canPublish: canSpeak,
            //         canSubscribe: true,
            //         canPublishData: true,
            //     }
            // });
        } catch (error) {
            console.error('Failed to update participant permissions:', error);
            // Не бросаем ошибку, так как участник может еще не подключиться
        }
    }

    /**
     * Удаляет голосовую комнату
     */
    async deleteVoiceRoom(roomId: string): Promise<void> {
        try {
            await this.roomService.deleteRoom(`voice-${roomId}`);
        } catch (error) {
            console.error('Failed to delete LiveKit room:', error);
        }
    }

    /**
     * Получает список участников в комнате
     */
    async getRoomParticipants(roomId: string) {
        try {
            const participants = await this.roomService.listParticipants(`voice-${roomId}`);
            return participants;
        } catch (error) {
            console.error('Failed to get room participants:', error);
            return [];
        }
    }

    /**
     * Отключает участника от комнаты
     */
    async disconnectParticipant(roomId: string, playerId: string): Promise<void> {
        try {
            await this.roomService.removeParticipant(`voice-${roomId}`, playerId);
        } catch (error) {
            console.error('Failed to disconnect participant:', error);
        }
    }
}

export default new LiveKitService();