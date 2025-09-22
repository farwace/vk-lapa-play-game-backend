import { Delayed } from "colyseus";
import { BaseHandler } from "./BaseHandler";
import { RoomStatus, GameStage } from "../schema/bunker/BunkerGameRoomState";
import { Player } from "../schema/bunker/Player";
import { TUser } from "../schema/bunker/types";

interface TurnTimers {
    reveal?: Delayed | null;
    finish?: Delayed | null;
}

export class BotManager extends BaseHandler {
    private static readonly MAX_BOTS = 3;
    private static readonly INITIAL_DELAY_MS = 20_000;
    private static readonly SPAWN_INTERVAL_MS = 10_000;
    private static readonly BOT_ID_START = 900_000_000;

    private botSpawnStartTimer: Delayed | null = null;
    private botSpawnInterval: Delayed | null = null;
    private turnTimers = new Map<string, TurnTimers>();
    private votingTimers = new Map<string, Delayed>();
    private botSequence = 0;

    private readonly botNamesMale = [
        "Андрей", "Борис", "Денис", "Егор", "Илья", "Кирилл", "Леонид", "Максим", "Никита", "Олег", "Александр", "Михаил", "Артём", "Даниил", "Дмитрий"
    ];
    private readonly botNamesFemale = [
        "Алина", "Виктория", "Дарья", "Екатерина", "Жанна", "Инна", "Карина", "Мария", "Наталья", "Оксана"
    ];

    public onHumanPlayerJoined(isReconnected = false): void {
        if (isReconnected || this.room.state.status !== RoomStatus.WAITING) {
            return;
        }

        this.stopBotSpawning();
        this.clearSpawnCountdown();

        if (this.shouldScheduleSpawning()) {
            this.startSpawnCountdown();
        }
    }

    public onHumanPlayerLeft(): void {
        if (this.room.state.status !== RoomStatus.WAITING) {
            return;
        }

        // Если остался единственный человек и боты еще не на максимуме — запускаем отсчет
        if (this.shouldScheduleSpawning()) {
            this.startSpawnCountdown();
        }
    }

    public onBotRemoved(): void {
        if (this.room.state.status !== RoomStatus.WAITING) {
            return;
        }

        this.stopBotSpawning();
        this.clearSpawnCountdown();

        if (this.shouldScheduleSpawning()) {
            this.startSpawnCountdown();
        }
    }

    public handleBotTurnStart(player: Player): void {
        if (!player.isBot) {
            return;
        }

        this.clearTurnTimers(player.id.toString());

        if (this.room.state.gameStage !== GameStage.CARD_REVEAL) {
            return;
        }

        const playerId = player.id.toString();
        const timers: TurnTimers = {};

        timers.reveal = this.room.clock.setTimeout(() => {
            if (!this.isCurrentBotTurn(playerId)) {
                this.clearTurnTimers(playerId);
                return;
            }

            const cardId = this.pickCardToReveal(player);
            if (cardId) {
                this.room.gameEngine.revealCard(playerId, cardId);
            }

            timers.finish = this.room.clock.setTimeout(() => {
                if (!this.isCurrentBotTurn(playerId)) {
                    this.clearTurnTimers(playerId);
                    return;
                }

                this.room.gameEngine.finishSpeaking(playerId);
                this.clearTurnTimers(playerId);
            }, 3_000);
        }, 3_000);

        this.turnTimers.set(playerId, timers);
    }

    public handleTurnFinished(playerId: string): void {
        this.clearTurnTimers(playerId);
    }

    public handleVotingStarted(): void {
        this.clearAllTurnTimers();
        this.clearVotingTimers();

        if (this.room.state.gameStage !== GameStage.VOTING) {
            return;
        }

        for (const bot of this.getActiveBots()) {
            const botId = bot.id.toString();
            const delay = 3_000 + Math.floor(Math.random() * 2_000);
            const timer = this.room.clock.setTimeout(() => {
                this.castVote(bot);
                this.votingTimers.delete(botId);
            }, delay);
            this.votingTimers.set(botId, timer);
        }
    }

    public handleVotingFinished(): void {
        this.clearVotingTimers();
    }

    public handleGameFinished(): void {
        this.stopBotSpawning();
        this.clearSpawnCountdown();
        this.clearAllTurnTimers();
        this.clearVotingTimers();
    }

    public cleanup(): void {
        this.handleGameFinished();
    }

    public onPrivateStatusChanged(isPrivate: boolean): void {
        this.stopBotSpawning();
        this.clearSpawnCountdown();

        if (!isPrivate && this.shouldScheduleSpawning()) {
            this.startSpawnCountdown();
        }
    }

    private shouldScheduleSpawning(): boolean {
        if (this.room.state.status !== RoomStatus.WAITING) {
            return false;
        }

        if (this.room.state.isPrivateRoom) {
            return false;
        }

        if (this.getHumanPlayers().length !== 1) {
            return false;
        }

        return this.getBotPlayers().length < BotManager.MAX_BOTS && this.getAvailableSeats() > 0;
    }

    private startSpawnCountdown(): void {
        if (this.botSpawnStartTimer) {
            return;
        }

        this.botSpawnStartTimer = this.room.clock.setTimeout(() => {
            this.botSpawnStartTimer = null;
            this.startBotSpawning();
        }, BotManager.INITIAL_DELAY_MS);
    }

    private clearSpawnCountdown(): void {
        if (this.botSpawnStartTimer) {
            this.botSpawnStartTimer.clear();
            this.botSpawnStartTimer = null;
        }
    }

    private startBotSpawning(): void {
        if (!this.shouldKeepSpawning()) {
            return;
        }

        this.botSpawnInterval = this.room.clock.setInterval(() => {
            if (!this.shouldKeepSpawning()) {
                this.stopBotSpawning();
                return;
            }

            const spawned = this.spawnBot();
            if (!spawned) {
                this.stopBotSpawning();
            }
        }, BotManager.SPAWN_INTERVAL_MS);
    }

    private stopBotSpawning(): void {
        if (this.botSpawnInterval) {
            this.botSpawnInterval.clear();
            this.botSpawnInterval = null;
        }
    }

    private shouldKeepSpawning(): boolean {
        if (this.room.state.status !== RoomStatus.WAITING) {
            return false;
        }

        if (this.room.state.isPrivateRoom) {
            return false;
        }

        if (this.getHumanPlayers().length > 1) {
            return false;
        }

        if (this.getBotPlayers().length >= BotManager.MAX_BOTS) {
            return false;
        }

        return this.getAvailableSeats() > 0;
    }

    private spawnBot(): boolean {
        const seatIndex = this.findFreeSeat();
        if (seatIndex === null) {
            return false;
        }

        const botProfile = this.generateBotProfile();
        const sessionId = `bot-${botProfile.id}`;
        const player = new Player(sessionId, botProfile, true);
        player.isReady = true;
        player.isConnected = true;
        player.canSpeak = false;

        this.room.state.players.set(botProfile.id.toString(), player);
        this.room.state.places.set(seatIndex.toString(), botProfile.id);
        this.room.updateMetadata();
        this.room.voiceHandler.broadcastVoiceStatus();

        this.room.broadcast('playerConnected', {
            ...botProfile,
            isBot: true
        });

        return true;
    }

    private findFreeSeat(): number | null {
        for (const [place, playerId] of this.room.state.places) {
            const seat = parseInt(place, 10);
            if (seat < this.room.state.playersCount && playerId === 0) {
                return seat;
            }
        }
        return null;
    }

    private getAvailableSeats(): number {
        let count = 0;
        for (const [place, playerId] of this.room.state.places) {
            const seat = parseInt(place, 10);
            if (seat < this.room.state.playersCount && playerId === 0) {
                count += 1;
            }
        }
        return count;
    }

    private getHumanPlayers(): Player[] {
        const result: Player[] = [];
        for (const [, player] of this.room.state.players) {
            if (!player.isBot) {
                result.push(player);
            }
        }
        return result;
    }

    private getBotPlayers(): Player[] {
        const result: Player[] = [];
        for (const [, player] of this.room.state.players) {
            if (player.isBot) {
                result.push(player);
            }
        }
        return result;
    }

    private getActiveBots(): Player[] {
        const result: Player[] = [];
        for (const [place, playerId] of this.room.state.places) {
            const seat = parseInt(place, 10);
            if (seat >= this.room.state.playersCount || playerId === 0) {
                continue;
            }
            const player = this.room.state.players.get(playerId.toString());
            if (player && player.isBot && !player.isEliminated) {
                result.push(player);
            }
        }
        return result;
    }

    private getActiveHumans(): Player[] {
        const result: Player[] = [];
        for (const [place, playerId] of this.room.state.places) {
            const seat = parseInt(place, 10);
            if (seat >= this.room.state.playersCount || playerId === 0) {
                continue;
            }
            const player = this.room.state.players.get(playerId.toString());
            if (player && !player.isBot && !player.isEliminated) {
                result.push(player);
            }
        }
        return result;
    }

    private generateBotProfile(): TUser {
        const isMale = Math.random() >= 0.5;
        const namesPool = isMale ? this.botNamesMale : this.botNamesFemale;
        const name = namesPool[Math.floor(Math.random() * namesPool.length)];

        const id = BotManager.BOT_ID_START + this.botSequence;
        this.botSequence += 1;

        return {
            id,
            name: `${name} Бот` ,
            isMale,
            experience: 0,
            level: 0,
            popularity: 0,
            popularityLevel: 0,
            isVip: false,
            isPremium: false,
            avatar: isMale ? "https://s3.lapa-play.ru/uploads/male-bot.png" : "https://s3.lapa-play.ru/uploads/bot-female.png"
        };
    }

    private pickCardToReveal(player: Player): string | null {
        const available = player.cards.filter(card => !card.isRevealed);
        if (available.length === 0) {
            return null;
        }
        const random = available[Math.floor(Math.random() * available.length)];
        return random.id;
    }

    private isCurrentBotTurn(playerId: string): boolean {
        return this.room.state.gameStage === GameStage.CARD_REVEAL && this.room.state.currentSpeakerId === playerId;
    }

    private clearTurnTimers(playerId: string): void {
        const timers = this.turnTimers.get(playerId);
        if (!timers) {
            return;
        }

        timers.reveal?.clear();
        timers.finish?.clear();
        this.turnTimers.delete(playerId);
    }

    private clearAllTurnTimers(): void {
        for (const playerId of this.turnTimers.keys()) {
            this.clearTurnTimers(playerId);
        }
    }

    private clearVotingTimers(): void {
        for (const timer of this.votingTimers.values()) {
            timer.clear();
        }
        this.votingTimers.clear();
    }

    private castVote(bot: Player): void {
        if (this.room.state.gameStage !== GameStage.VOTING) {
            return;
        }

        const voterId = bot.id.toString();
        if (this.room.state.currentVotes.has(voterId)) {
            return;
        }

        let targetId = "0";

        if (!this.room.state.canAbstainThisRound) {
            const otherBots = this.getActiveBots().filter(player => player.id !== bot.id);
            if (otherBots.length > 0) {
                const target = otherBots[Math.floor(Math.random() * otherBots.length)];
                targetId = target.id.toString();
            } else {
                const humans = this.getActiveHumans();
                if (humans.length > 0) {
                    const target = humans[Math.floor(Math.random() * humans.length)];
                    targetId = target.id.toString();
                } else {
                    targetId = voterId; // fallback to self to keep the flow
                }
            }
        }

        this.room.gameEngine.vote(voterId, targetId);
    }
}
