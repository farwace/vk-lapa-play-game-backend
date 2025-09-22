import {Client, Room} from "@colyseus/core";
import {StateView} from "@colyseus/schema";
import {BunkerGameRoomState, RoomStatus} from "./schema/bunker/BunkerGameRoomState";
import {Delayed, updateLobby} from "colyseus";
import ApiService from "../services/ApiService";
import {Player} from "./schema/bunker/Player";
import { PlayerHandler } from "./handlers/PlayerHandler";
import { RoomHandler } from "./handlers/RoomHandler";
import { GameHandler } from "./handlers/GameHandler";
import { GameUtils } from "./handlers/GameUtils";
import { GameEngine } from "./handlers/GameEngine";
import { VoiceHandler } from "./handlers/VoiceHandler";

const CUSTOM_ID_REGISTRY_KEY = "bunker:rooms:customIds";


export class BunkerGameRoom extends Room<BunkerGameRoomState> {
    maxClients = 12;
    state = new BunkerGameRoomState();

    public turnTimer: Delayed | null = null;
    public gameEngine: GameEngine;
    public voiceHandler: VoiceHandler;


    private playerHandler: PlayerHandler;
    private roomHandler: RoomHandler;
    private gameHandler: GameHandler;

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

    async onCreate(options: any) {
        // Инициализация обработчиков
        this.playerHandler = new PlayerHandler(this);
        this.roomHandler = new RoomHandler(this);
        this.gameHandler = new GameHandler(this);
        this.gameEngine = new GameEngine(this);
        this.voiceHandler = new VoiceHandler(this);

        await this.voiceHandler.createVoiceRoom();

        if(options?.isPrivate){
            this.state.isPrivateRoom = true;
        }
        this.state.customId = await this.resolveCustomId(options?.customId);

        let cntPlayers = 8;

        if(options?.playersCount){
            if(parseInt(options?.playersCount) >= this.state.minPlayers && parseInt(options?.playersCount) <= this.state.maxPlayers){
                cntPlayers = parseInt(options?.playersCount);
            }
        }

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
        const userData = await ApiService.authenticatePlayer(options.authString || '');
        if (!userData) throw new Error('Не удалось идентифицировать игрока');

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
        client.view = new StateView();
        client.view.add(player);

        this.broadcast(isReconnected ? 'playerReconnected' : 'playerConnected', userData);

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
    }

    public findPlayerByClientSessionId(sessionId: string): Player | undefined {
        for(const [playerId, player] of this.state.players.entries()) {
            if(player.sessionId == sessionId){
                return player;
            }
        }
        return undefined;
    }

    private assignNewHost(ignorePlayerId: number) {
        for(const [playerId, player] of this.state.players.entries()) {
            if(player.id != ignorePlayerId){
                this.state.hostId = player.id;
                this.broadcast("leaderChanged", player.id);
                return;
            }
        }
        this.state.hostId = 0;
    }

    onLeave(client: Client, consented: boolean) {
        const player = this.findPlayerByClientSessionId(client.sessionId);
        if (!player) { return; }

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

        this.updateMetadata();
        this.broadcast("playerLeft", { playerId: player.id });

        // Обновляем голосовые разрешения
        this.voiceHandler.broadcastVoiceStatus();
    }

    async onDispose() {
        this.turnTimer?.clear();
        this.turnTimer = null;
        ApiService.sendEndGame(this.state.customId, []);
        if (this.gameEngine) {
            this.gameEngine.cleanup();
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
