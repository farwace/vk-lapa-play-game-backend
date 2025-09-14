import { BaseHandler } from "./BaseHandler";
import LiveKitService from "../../services/LiveKitService";
import { GameStage } from "../schema/bunker/BunkerGameRoomState";

export class VoiceHandler extends BaseHandler {
    /**
     * Создает голосовую комнату при создании игровой комнаты
     */
    async createVoiceRoom(): Promise<void> {
        try {
            const voiceRoom = await LiveKitService.createVoiceRoom(this.room.roomId);
            this.room.state.voiceRoomId = `voice-${this.room.roomId}`;
            //console.log(`Voice room created: ${this.room.state.voiceRoomId}`);
        } catch (error) {
            console.error('Failed to create voice room:', error);
        }
    }

    /**
     * Генерирует токен для подключения игрока к голосовой комнате
     */
    async generateVoiceToken(playerId: string, playerName: string): Promise<string | null> {
        try {
            const canSpeak = this.canPlayerSpeak(playerId);
            return LiveKitService.generateAccessToken(
                this.room.roomId,
                playerId,
                playerName,
                canSpeak
            );
        } catch (error) {
            console.error('Failed to generate voice token:', error);
            return null;
        }
    }

    /**
     * Определяет, может ли игрок говорить в данный момент
     */
    canPlayerSpeak(playerId: string): boolean {
        const player = this.room.state.players.get(playerId);
        if (!player || player.isEliminated || !player.isConnected) {
            return false;
        }

        // Проверяем, что игрок на месте (не спектатор)
        let isOnPlace = false;
        for (const [place, placePlayerId] of this.room.state.places) {
            if (parseInt(place) < this.room.state.playersCount && placePlayerId === player.id) {
                isOnPlace = true;
                break;
            }
        }

        if (!isOnPlace) {
            return false;
        }

        // Если указан конкретный говорящий, только он может говорить
        if (this.room.state.currentSpeakerId && this.room.state.currentSpeakerId !== "0") {
            return this.room.state.currentSpeakerId === playerId;
        }

        // В остальных случаях все активные игроки могут говорить
        return true;
    }

    /**
     * Обновляет разрешения для всех участников голосовой комнаты
     */
    async updateAllParticipantsPermissions(): Promise<void> {
        if (!this.room.state.voiceRoomId) {
            return;
        }

        for (const [playerId, player] of this.room.state.players) {
            if (player.isConnected) {
                const canSpeak = this.canPlayerSpeak(playerId);
                await this.updateParticipantPermissions(playerId, canSpeak);
            }
        }
    }

    /**
     * Обновляет разрешения конкретного участника
     */
    async updateParticipantPermissions(playerId: string, canSpeak: boolean): Promise<void> {
        try {
            await LiveKitService.updateParticipantPermissions(
                this.room.roomId,
                playerId,
                canSpeak
            );
        } catch (error) {
            console.error(`Failed to update permissions for player ${playerId}:`, error);
        }
    }

    /**
     * Отправляет обновление статуса голоса всем клиентам
     */
    broadcastVoiceStatus(): void {
        const voiceStatus: { [key: string]: boolean } = {};

        for (const [playerId] of this.room.state.players) {
            voiceStatus[playerId] = this.canPlayerSpeak(playerId);
        }

        this.room.broadcast("voiceStatusUpdate", {
            currentSpeaker: this.room.state.currentSpeakerId,
            voiceStatus: voiceStatus
        });
    }

    /**
     * Удаляет голосовую комнату
     */
    async deleteVoiceRoom(): Promise<void> {
        if (this.room.state.voiceRoomId) {
            try {
                await LiveKitService.deleteVoiceRoom(this.room.roomId);
                //console.log(`Voice room deleted: ${this.room.state.voiceRoomId}`);
            } catch (error) {
                console.error('Failed to delete voice room:', error);
            }
        }
    }

    /**
     * Отключает игрока от голосовой комнаты
     */
    async disconnectPlayerFromVoice(playerId: string): Promise<void> {
        try {
            await LiveKitService.disconnectParticipant(this.room.roomId, playerId);
        } catch (error) {
            console.error(`Failed to disconnect player ${playerId} from voice:`, error);
        }
    }
}
