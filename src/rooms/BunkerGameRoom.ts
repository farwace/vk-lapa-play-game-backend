import {Client, Room} from "@colyseus/core";
import {StateView} from "@colyseus/schema";
import {BunkerGameRoomState, RoomStatus} from "./schema/bunker/BunkerGameRoomState";
import {Delayed, updateLobby} from "colyseus";
import ApiService from "../services/ApiService";
import ConsoleService from "../services/ConsoleService";
import {Player} from "./schema/bunker/Player";
import { PlayerHandler } from "./handlers/PlayerHandler";
import { RoomHandler } from "./handlers/RoomHandler";
import { GameHandler } from "./handlers/GameHandler";
import { GameUtils } from "./handlers/GameUtils";
import { GameEngine } from "./handlers/GameEngine";
import { VoiceHandler } from "./handlers/VoiceHandler";
import { BotManager } from "./handlers/BotManager";

const CUSTOM_ID_REGISTRY_KEY = "bunker:rooms:customIds";


export class BunkerGameRoom extends Room<BunkerGameRoomState> {
    maxClients = 12;
    state = new BunkerGameRoomState();

    public turnTimer: Delayed | null = null;
    private emptyRoomDisposeTimer: Delayed | null = null;
    public gameEngine: GameEngine;
    public voiceHandler: VoiceHandler;
    public botManager: BotManager;


    private playerHandler: PlayerHandler;
    private roomHandler: RoomHandler;
    public gameHandler: GameHandler;

    private static readonly EMPTY_ROOM_DISPOSE_DELAY_MS = 30_000;
    private static readonly KICK_COOLDOWN_MS = 30_000;
    private static readonly CUSTOM_ID_MAX_LENGTH = 64;
    private static readonly AUTH_STRING_MAX_LENGTH = 2048;
    private static readonly CUSTOM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

    private allCardTypes = [
        "cardsProfession",
        "cardsAge",
        "cardsHealth",
        "cardsCharacteristic",
        "cardsAdditionalInformation",
        "cardsPhobias",
        "cardsSkills",
        "cardsLuggage"
    ];

    private kickedPlayersCooldowns: Map<number, number> = new Map<number, number>();

    async onCreate(options: any) {
        // Вручную управляем уничтожением комнаты, чтобы дать время на реконнект
        this.autoDispose = false;

        // Инициализация обработчиков
        this.playerHandler = new PlayerHandler(this);
        this.roomHandler = new RoomHandler(this);
        this.gameHandler = new GameHandler(this);
        this.gameEngine = new GameEngine(this);
        this.voiceHandler = new VoiceHandler(this);
        this.botManager = new BotManager(this);

        await this.voiceHandler.createVoiceRoom();

        const normalizedOptions = this.normalizeCreateOptions(options);

        if (normalizedOptions.isPrivateRoom !== undefined) {
            this.state.isPrivateRoom = normalizedOptions.isPrivateRoom;
        }

        if (normalizedOptions.useBots !== undefined) {
            this.state.useBots = normalizedOptions.useBots;
        }

        try {
            this.state.customId = await this.resolveCustomId(normalizedOptions.customId);
        } catch (error) {
            ConsoleService.warn('Failed to assign custom room id, using generated one instead.', error);
            this.state.customId = await this.resolveCustomId();
        }

        const cntPlayers = normalizedOptions.playersCount ?? this.state.playersCount;

        this.allCardTypes.forEach(type => this.state.activeCardTypes.push(type));
        this.state.playersCount = cntPlayers;

        for (let i = 0; i < this.state.playersCount; i++) {
            this.state.places.set(i.toString(), 0);
        }

        this.updateMetadata();

        // Привязка обработчиков сообщений
        this.onMessage('changePlace', this.playerHandler.onChangePlace.bind(this.playerHandler));
        this.onMessage('kickPlayer', this.playerHandler.onKickPlayer.bind(this.playerHandler));
        this.onMessage('setLeaderPlayer', this.playerHandler.onSetLeaderPlayer.bind(this.playerHandler));
        this.onMessage('togglePrivateRoom', this.roomHandler.onTogglePrivate.bind(this.roomHandler));
        this.onMessage('toggleUseBotsValue', this.roomHandler.onToggleBots.bind(this.roomHandler));
        this.onMessage('changePlayersCount', this.roomHandler.onChangePlayersCount.bind(this.roomHandler));
        this.onMessage('ready', this.gameHandler.onReady.bind(this.gameHandler));

        // Новые обработчики для игрового процесса
        this.onMessage('revealCard', this.gameHandler.onRevealCard.bind(this.gameHandler));
        this.onMessage('finishSpeaking', this.gameHandler.onFinishSpeaking.bind(this.gameHandler));
        this.onMessage('vote', this.gameHandler.onVote.bind(this.gameHandler));

        this.onMessage('requestVoiceToken', this.onRequestVoiceToken.bind(this));
    }


    public updateMetadata = () => {
        let availablePlaces = 0;

        for(const [index, playerId] of this.state.places){
            if(!playerId && (+index < this.state.playersCount)){
                availablePlaces += 1;
            }
        }

        const canJoin = !this.state.isPrivateRoom && availablePlaces > 0 && (this.state.status === RoomStatus.WAITING || this.state.status === RoomStatus.FINISHED);

        this.setMetadata({
            availablePlaces: availablePlaces,
            status: this.state.status,
            isPrivate: this.state.isPrivateRoom,
            canJoin: canJoin,
            customId: this.state.customId
        }).then(() => updateLobby(this));
    }

    private clearEmptyRoomDisposeTimer(): void {
        if (this.emptyRoomDisposeTimer) {
            this.emptyRoomDisposeTimer.clear();
            this.emptyRoomDisposeTimer = null;
        }
    }

    private scheduleEmptyRoomDisposeIfNeeded(): void {
        if (this.clients.length > 0) {
            this.clearEmptyRoomDisposeTimer();
            return;
        }

        if (this.emptyRoomDisposeTimer) {
            return;
        }

        this.emptyRoomDisposeTimer = this.clock.setTimeout(() => {
            this.emptyRoomDisposeTimer = null;

            if (this.clients.length === 0) {
                void this.disconnect().catch((error) => {
                    ConsoleService.error('Failed to dispose room after empty timeout:', error);
                });
            }
        }, BunkerGameRoom.EMPTY_ROOM_DISPOSE_DELAY_MS);
    }

    private normalizeCreateOptions(options: unknown): {
        isPrivateRoom?: boolean;
        useBots?: boolean;
        playersCount?: number;
        customId?: string;
    } {
        const normalized: {
            isPrivateRoom?: boolean;
            useBots?: boolean;
            playersCount?: number;
            customId?: string;
        } = {};

        if (!options || typeof options !== 'object') {
            return normalized;
        }

        const raw = options as Record<string, unknown>;

        if (typeof raw.isPrivate === 'boolean') {
            normalized.isPrivateRoom = raw.isPrivate;
        }

        if (typeof raw.useBots === 'boolean') {
            normalized.useBots = raw.useBots;
        }

        const playersCountCandidate = this.extractNumber(raw.playersCount);
        if (playersCountCandidate !== undefined) {
            const boundedPlayersCount = Math.max(
                this.state.minPlayers,
                Math.min(this.state.maxPlayers, playersCountCandidate)
            );
            normalized.playersCount = boundedPlayersCount;
        }

        const customId = this.normalizeCustomId(raw.customId);
        if (customId) {
            normalized.customId = customId;
        }

        return normalized;
    }

    private normalizeCustomId(rawCustomId: unknown): string | undefined {
        if (rawCustomId === undefined || rawCustomId === null) {
            return undefined;
        }

        const asString = String(rawCustomId).trim();
        if (!asString) {
            return undefined;
        }

        if (asString.length > BunkerGameRoom.CUSTOM_ID_MAX_LENGTH) {
            ConsoleService.warn('Received customId that exceeds maximum length, ignoring.');
            return undefined;
        }

        if (!BunkerGameRoom.CUSTOM_ID_PATTERN.test(asString)) {
            ConsoleService.warn('Received customId with disallowed characters, ignoring.');
            return undefined;
        }

        return asString;
    }

    private extractNumber(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.floor(value);
        }

        if (typeof value === 'string' && value.trim() !== '') {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return undefined;
    }

    private extractAuthString(options: unknown): string {
        if (!options || typeof options !== 'object') {
            return '';
        }

        const rawAuth = (options as Record<string, unknown>).authString;
        if (typeof rawAuth !== 'string') {
            return '';
        }

        if (rawAuth.length > BunkerGameRoom.AUTH_STRING_MAX_LENGTH) {
            ConsoleService.warn('Received authString longer than allowed, truncating.');
            return rawAuth.slice(0, BunkerGameRoom.AUTH_STRING_MAX_LENGTH);
        }

        return rawAuth;
    }

    public applyKickCooldown(playerId: number): void {
        const expiresAt = Date.now() + BunkerGameRoom.KICK_COOLDOWN_MS;
        this.kickedPlayersCooldowns.set(playerId, expiresAt);

        this.clock.setTimeout(() => {
            const storedExpiresAt = this.kickedPlayersCooldowns.get(playerId);
            if (storedExpiresAt !== undefined && storedExpiresAt <= Date.now()) {
                this.kickedPlayersCooldowns.delete(playerId);
            }
        }, BunkerGameRoom.KICK_COOLDOWN_MS);
    }

    private getKickCooldownRemainingMs(playerId: number): number {
        const expiresAt = this.kickedPlayersCooldowns.get(playerId);
        if (expiresAt === undefined) {
            return 0;
        }

        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            this.kickedPlayersCooldowns.delete(playerId);
            return 0;
        }

        return remaining;
    }

    private async resolveCustomId(providedCustomId?: unknown): Promise<string> {
        const providedAsString =
            providedCustomId !== undefined && providedCustomId !== null
                ? String(providedCustomId)
                : "";
        const requestedId = providedAsString.trim();

        if (!requestedId) {
            await this.presence.sadd(CUSTOM_ID_REGISTRY_KEY, this.roomId);
            return this.roomId;
        }

        if (requestedId.length > BunkerGameRoom.CUSTOM_ID_MAX_LENGTH) {
            throw new Error("CUSTOM_ID_TOO_LONG");
        }

        if (!BunkerGameRoom.CUSTOM_ID_PATTERN.test(requestedId)) {
            throw new Error("CUSTOM_ID_INVALID_CHARS");
        }

        const isTaken = await this.presence.sismember(CUSTOM_ID_REGISTRY_KEY, requestedId);
        if (isTaken) {
            throw new Error("CUSTOM_ID_ALREADY_IN_USE");
        }

        await this.presence.sadd(CUSTOM_ID_REGISTRY_KEY, requestedId);
        return requestedId;
    }

    private startTurnTimer(callback?:(args:any)=>void, args?: any) {
        this.turnTimer?.clear();
        this.turnTimer = null;

        this.state.turnTimeRemaining = this.state.turnTimeLimit;
        this.turnTimer = this.clock.setInterval(() => {
            this.state.turnTimeRemaining--;
            if (this.state.turnTimeRemaining <= 0) {
                this.turnTimer?.clear();
                this.turnTimer = null;
                callback?.(args);
            }
        }, 1000);
    }

    private onRequestVoiceToken = async (client: Client) => {
        const player = this.findPlayerByClientSessionId(client.sessionId);
        if (!player) {
            client.send('error', 'Игрок не найден');
            return;
        }

        const token = await this.voiceHandler.generateVoiceToken(
            player.id.toString(),
            player.name
        );

        if (token) {
            client.send('voiceToken', {
                token: token,
                roomName: this.state.voiceRoomId,
                canSpeak: this.voiceHandler.canPlayerSpeak(player.id.toString())
            });
        } else {
            client.send('error', 'Не удалось сгенерировать голосовой токен');
        }
    }

    async onJoin(client: Client, options: any) {
        const authString = this.extractAuthString(options);
        const userData = await ApiService.authenticatePlayer(authString);
        if (!userData) throw new Error('Не удалось идентифицировать игрока');

        const kickCooldownMs = this.getKickCooldownRemainingMs(userData.id);
        if (kickCooldownMs > 0) {
            const remainingSeconds = Math.ceil(kickCooldownMs / 1000);
            client.send('error', `Вы были исключены из комнаты. Попробуйте снова через ${remainingSeconds} секунд.`);
            await client.leave(4000, "Kick cooldown active");
            return;
        }

        let isReconnected = false;

        let player = this.state.players.get(userData.id.toString());
        if (!player) {
            player = new Player(client.sessionId, userData);
        } else {
            isReconnected = true;
            player.sessionId = client.sessionId;
        }

        let placed = false;
        let existingSeatIndex: string | null = null;

        // Ensure the player is not occupying multiple seats
        for (const [index, pid] of this.state.places) {
            if (pid == player.id) {
                if (existingSeatIndex === null && (+index < this.state.playersCount)) {
                    existingSeatIndex = index;
                    placed = true;
                } else {
                    this.state.places.set(index, 0);
                }
            }
        }

        if (existingSeatIndex !== null && +existingSeatIndex >= this.state.playersCount) {
            this.state.places.set(existingSeatIndex, 0);
            placed = false;
            existingSeatIndex = null;
        }

        if (!placed && this.state.status === RoomStatus.WAITING) {
            for (const [index, pid] of this.state.places) {
                if (!pid && (+index < this.state.playersCount)) {
                    this.state.places.set(index, player.id);
                    placed = true;
                    break;
                }
            }
        }

        if(!placed){
            client.send('youAreSpectator');
        }
        else{
            player.canSpeak = true;
            this.updateMetadata();
        }

        player.isConnected = true;

        const discIdx = this.state.disconnectedPlayers.indexOf(player.id.toString());
        if (discIdx > -1) this.state.disconnectedPlayers.splice(discIdx, 1);

        if (this.clients.length === 0 || this.state.hostId === 0) {
            this.state.hostId = player.id;
        }

        this.state.players.set(player.id.toString(), player);
        this.ensureHumanHostAssigned();

        client.view = new StateView();
        client.view.add(player);

        this.broadcast(isReconnected ? 'playerReconnected' : 'playerConnected', {
            ...userData,
            isBot: false
        });

        // Отправляем голосовой токен новому игроку
        const voiceToken = await this.voiceHandler.generateVoiceToken(
            player.id.toString(),
            player.name
        );

        if (voiceToken) {
            client.send('voiceToken', {
                token: voiceToken,
                roomName: this.state.voiceRoomId,
                canSpeak: this.voiceHandler.canPlayerSpeak(player.id.toString())
            });
        }

        // Обновляем статус голоса для всех
        this.voiceHandler.broadcastVoiceStatus();

        if (!player.isBot) {
            this.botManager.onHumanPlayerJoined(isReconnected);
        }

        this.clearEmptyRoomDisposeTimer();
    }

    public findPlayerByClientSessionId(sessionId: string): Player | undefined {
        for(const [playerId, player] of this.state.players.entries()) {
            if(player.sessionId == sessionId){
                return player;
            }
        }
        return undefined;
    }

    private findHostCandidate(options?: { ignorePlayerId?: number; botsOnly?: boolean }): Player | undefined {
        const ignoreId = options?.ignorePlayerId;
        const botsOnly = options?.botsOnly ?? false;

        for (const [, player] of this.state.players) {
            if (ignoreId !== undefined && player.id === ignoreId) {
                continue;
            }

            if (botsOnly) {
                if (player.isBot) {
                    return player;
                }
            } else if (!player.isBot) {
                return player;
            }
        }

        return undefined;
    }

    private assignNewHost(ignorePlayerId: number) {
        const humanHost = this.findHostCandidate({ ignorePlayerId });
        const newHost = humanHost ?? this.findHostCandidate({ ignorePlayerId, botsOnly: true });

        if (newHost) {
            const hostChanged = this.state.hostId !== newHost.id;
            this.state.hostId = newHost.id;
            if (hostChanged) {
                this.broadcast("leaderChanged", newHost.id);
            }
            return;
        }

        this.state.hostId = 0;
    }

    private ensureHumanHostAssigned() {
        const currentHost = this.state.players.get(this.state.hostId.toString());

        if (currentHost && !currentHost.isBot) {
            return;
        }

        const humanHost = this.findHostCandidate();
        if (!humanHost) {
            return;
        }

        const hostChanged = this.state.hostId !== humanHost.id;
        this.state.hostId = humanHost.id;
        if (hostChanged) {
            this.broadcast("leaderChanged", humanHost.id);
        }
    }

    onLeave(client: Client, consented: boolean) {
        const player = this.findPlayerByClientSessionId(client.sessionId);
        if (!player) { return; }
        if(!player.isBot){
            this.allowReconnection(client, 20);
        }

        if(this.state.status == RoomStatus.PLAYING) {
            player.isConnected = false;
            this.broadcast("playerDisconnected", { playerId: player.id });

            // Отключаем игрока от голосовой комнаты
            this.voiceHandler.disconnectPlayerFromVoice(player.id.toString());

            // Если отключившийся игрок сейчас говорит, обрабатываем это в игровом движке
            if (player.id.toString() === this.state.currentSpeakerId && this.gameEngine) {
                // GameEngine сам обработает отключение игрока во время его хода
            }

            // Обновляем голосовые разрешения
            this.voiceHandler.updateAllParticipantsPermissions();
            this.voiceHandler.broadcastVoiceStatus();

            if (!player.isBot) {
                this.botManager.onHumanPlayerLeft();
            }

            this.scheduleEmptyRoomDisposeIfNeeded();

            return;
        }

        for (const [index, placePlayerId] of this.state.places) {
            if (placePlayerId === player.id) {
                this.state.places.set(index, 0);
                break;
            }
        }

        if (this.state.hostId == player.id) {
            this.assignNewHost(player.id);
        }

        this.state.players.delete(player.id.toString());
        this.state.disconnectedPlayers.push(player.id.toString());

        if (!player.isBot) {
            this.botManager.onHumanPlayerLeft();
        }

        this.updateMetadata();
        this.broadcast("playerLeft", { playerId: player.id });

        // Обновляем голосовые разрешения
        this.voiceHandler.broadcastVoiceStatus();

        this.scheduleEmptyRoomDisposeIfNeeded();
    }

    async onDispose() {
        this.clearEmptyRoomDisposeTimer();
        this.turnTimer?.clear();
        this.turnTimer = null;
        ApiService.sendEndGame(this.state.customId, []);
        if (this.gameEngine) {
            this.gameEngine.cleanup();
        }

        if (this.botManager) {
            this.botManager.cleanup();
        }

        if (this.state.customId) {
            await this.presence.srem(CUSTOM_ID_REGISTRY_KEY, this.state.customId);
        }

        // Удаляем голосовую комнату
        if (this.voiceHandler) {
            await this.voiceHandler.deleteVoiceRoom();
        }
    }


    public replacePlayersPlaces = () => {
        GameUtils.replacePlayersPlaces(this);
    }

    public startGame = () => {
        let playersCount = 0;
        const playerIds = [];

        for (const [index, placePlayerId] of this.state.places) {
            if (placePlayerId != 0) {
                playersCount+=1;
                playerIds.push(placePlayerId);
            }
        }
        let abstainRounds = Math.abs(this.state.maxPlayers - playersCount) +1;
        if(abstainRounds > 4){
            abstainRounds = 4;
        }
        this.state.maxAbstainRounds = abstainRounds;

        if (this.gameEngine) {
            this.state.currentRound = 1;
            this.gameEngine.startGame();

            try {
                ApiService.sendStartGame(this.state.customId, playerIds);
            }
            catch (e: any){}
        }
    }

    public gameInit = async () => {
        await GameUtils.initGame(this);
    }
}
