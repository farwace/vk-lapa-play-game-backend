import { BunkerGameRoom } from "../BunkerGameRoom";
import { GameStage, RoomStatus } from "../schema/bunker/BunkerGameRoomState";
import { Player } from "../schema/bunker/Player";
import {Card, CardCustomData} from "../schema/bunker/Card";
import ApiService from "../../services/ApiService";

export class GameEngine {
    private room: BunkerGameRoom;
    private speakingPlayerQueue: number[] = [];
    private currentPlayerIndex: number = 0;
    private cardRevealTimer: any = null;
    private hasRevealedThisTurn = new Set<string>();
    private isVotingActive = false;

    constructor(room: BunkerGameRoom) {
        this.room = room;
    }

    public startGame() {
        this.room.state.gameStage = GameStage.CARD_REVEAL;
        this.room.state.canAbstainThisRound = this.room.state.currentRound <= this.room.state.maxAbstainRounds;
        this.hasRevealedThisTurn.clear();

        // Создаем очередь активных игроков (не исключенных)
        this.createPlayerQueue();

        if (this.speakingPlayerQueue.length > 0) {
            this.currentPlayerIndex = 0;
            this.startPlayerTurn();
        }
    }

    private createPlayerQueue() {
        this.speakingPlayerQueue = [];

        // Собираем игроков с мест, которые не исключены
        for (const [place, playerId] of this.room.state.places) {
            if (parseInt(place) < this.room.state.playersCount && playerId > 0) {
                const player = this.room.state.players.get(playerId.toString());
                if (player && !player.isEliminated) {
                    this.speakingPlayerQueue.push(playerId);
                }
            }
        }
    }

    private async startPlayerTurn() {
        if (this.currentPlayerIndex >= this.speakingPlayerQueue.length) {
            // Все игроки высказались, переходим к голосованию
            this.startVoting();
            return;
        }

        const currentPlayerId = this.speakingPlayerQueue[this.currentPlayerIndex];
        const currentPlayer = this.room.state.players.get(currentPlayerId.toString());

        if (!currentPlayer || currentPlayer.isEliminated) {
            this.room.botManager.handleTurnFinished(currentPlayerId.toString());
            this.nextPlayer();
            return;
        }

        this.room.state.currentSpeakerId = currentPlayerId.toString();
        this.room.state.turnTimeRemaining = this.room.state.turnTimeLimit;
        this.room.state.cardRevealTimeRemaining = 25;
        this.hasRevealedThisTurn.delete(this.room.state.currentSpeakerId);

        // Обновляем голосовые разрешения
        await this.room.voiceHandler.updateAllParticipantsPermissions();
        this.room.voiceHandler.broadcastVoiceStatus();

        // Если игрок отключен, сразу открываем случайную карту и переходим к следующему через 3 секунды
        if (!currentPlayer.isConnected) {
            this.forceRevealRandomCard(currentPlayer);
            this.room.clock.setTimeout(() => {
                this.nextPlayer();
            }, 3000);
            return;
        }

        this.room.broadcast("playerTurnStarted", {
            playerId: currentPlayerId,
            timeRemaining: this.room.state.turnTimeRemaining,
            cardRevealTime: this.room.state.cardRevealTimeRemaining
        });

        // Запускаем таймер для карты (25 секунд)
        this.startCardRevealTimer(currentPlayer);

        this.room.botManager.handleBotTurnStart(currentPlayer);

        // Запускаем общий таймер хода (30 секунд)
        this.room.turnTimer = this.room.clock.setInterval(() => {
            this.room.state.turnTimeRemaining--;

            if (this.room.state.turnTimeRemaining <= 0) {
                this.room.turnTimer?.clear();
                this.room.turnTimer = null;
                this.nextPlayer();
            }
        }, 1000);
    }

    private startCardRevealTimer(player: Player) {
        this.cardRevealTimer = this.room.clock.setInterval(() => {
            this.room.state.cardRevealTimeRemaining--;

            if (this.room.state.cardRevealTimeRemaining <= 0) {
                if (this.cardRevealTimer) {
                    this.cardRevealTimer.clear();
                    this.cardRevealTimer = null;
                }

                // Принудительно открываем случайную карту, если игрок не сделал выбор
                this.forceRevealRandomCard(player);
            }
        }, 1000);
    }

    public revealCard(playerId: string, cardId: string): boolean {
        const player = this.room.state.players.get(playerId);
        if (!player || player.id.toString() !== this.room.state.currentSpeakerId) {
            return false;
        }

        // Проверяем, что карта принадлежит игроку
        const cardIndex = player.cards.findIndex(card => card.id == cardId);
        if (cardIndex === -1) {
            return false;
        }

        // Проверяем, что карта еще не открыта
        const isAlreadyRevealed = player.revealedCards.some(card => card.id == cardId);
        if (isAlreadyRevealed) {
            return false;
        }

        // Копируем карту в открытые
        const card = player.cards[cardIndex];

        const revealedCard = new Card(
            card.id,
            card.name,
            card.type,
            card.active,
            card.maleImageUrl,
            card.femaleImageUrl,
            card.customData,
            card.value
        );
        revealedCard.isRevealed = true;
        player.revealedCards.push(revealedCard);
        card.isRevealed = true;

        // Останавливаем таймер для карт
        if (this.cardRevealTimer) {
            this.cardRevealTimer.clear();
            this.cardRevealTimer = null;
        }
        this.room.state.cardRevealTimeRemaining = 0;

        this.room.broadcast("cardRevealed", {
            playerId: player.id,
            card: {
                id: revealedCard.id,
                name: revealedCard.name,
                type: revealedCard.type,
                imageUrl: player.isMale ? revealedCard.maleImageUrl : revealedCard.femaleImageUrl,
                customData: revealedCard.customData
            }
        });

        this.hasRevealedThisTurn.add(playerId);
        return true;
    }

    private forceRevealRandomCard(player: Player) {
        if (this.hasRevealedThisTurn.has(player.id.toString())) {
            return;
        }

        // Находим карты, которые еще не открыты
        const unrevealedCards = player.cards.filter(card =>
            !player.revealedCards.some(revealed => revealed.id === card.id)
        );

        if (unrevealedCards.length === 0) {
            return; // Нет карт для открытия
        }

        // Выбираем случайную карту
        const randomIndex = Math.floor(Math.random() * unrevealedCards.length);
        const cardToReveal = unrevealedCards[randomIndex];

        // Копируем карту в открытые
        const revealedCard = new Card(
            cardToReveal.id,
            cardToReveal.name,
            cardToReveal.type,
            cardToReveal.active,
            cardToReveal.maleImageUrl,
            cardToReveal.femaleImageUrl,
            cardToReveal.customData,
            cardToReveal.value
        );
        revealedCard.isRevealed = true;
        player.revealedCards.push(revealedCard);

        this.room.broadcast("cardRevealed", {
            playerId: player.id,
            card: {
                id: revealedCard.id,
                name: revealedCard.name,
                type: revealedCard.type,
                imageUrl: player.isMale ? revealedCard.maleImageUrl : revealedCard.femaleImageUrl,
                customData: revealedCard.customData
            }
        });
        this.hasRevealedThisTurn.add(player.id.toString());
    }

    public finishSpeaking(playerId: string): boolean {
        if (playerId !== this.room.state.currentSpeakerId) {
            return false;
        }

        const player = this.room.state.players.get(playerId);
        if (!player) {
            return false;
        }

        // Если карта еще не открыта, принудительно открываем случайную
        if (this.room.state.cardRevealTimeRemaining > 0) {
            this.forceRevealRandomCard(player);
        }

        if (this.cardRevealTimer) {
            this.cardRevealTimer.clear();
            this.cardRevealTimer = null;
        }

        if (this.room.turnTimer) {
            this.room.turnTimer.clear();
            this.room.turnTimer = null;
        }

        this.room.botManager.handleTurnFinished(playerId);
        this.nextPlayer();
        return true;
    }

    private async nextPlayer() {
        const previousSpeakerId = this.room.state.currentSpeakerId;
        if (previousSpeakerId) {
            this.room.botManager.handleTurnFinished(previousSpeakerId);
            this.hasRevealedThisTurn.delete(previousSpeakerId);
        }

        this.currentPlayerIndex++;

        if (this.currentPlayerIndex >= this.speakingPlayerQueue.length) {
            this.startVoting();
        } else {
            this.startPlayerTurn();
        }
    }

    private async startVoting() {
        this.room.state.currentVotes.clear();
        this.room.state.gameStage = GameStage.VOTING;
        this.room.state.currentSpeakerId = "";
        this.room.state.turnTimeRemaining = 30; // 30 секунд на голосование
        this.isVotingActive = true;

        await this.room.voiceHandler.updateAllParticipantsPermissions();
        this.room.voiceHandler.broadcastVoiceStatus();

        this.room.botManager.handleVotingStarted();


        // Сбрасываем голоса всех игроков
        for (const [_, player] of this.room.state.players) {
            player.votesAgainst = 0;
        }

        this.room.broadcast("votingStarted", {
            timeRemaining: this.room.state.turnTimeRemaining,
            canAbstain: this.room.state.canAbstainThisRound,
            round: this.room.state.currentRound
        });

        this.room.turnTimer = this.room.clock.setInterval(() => {
            this.room.state.turnTimeRemaining--;

            if (this.room.state.turnTimeRemaining <= 0) {
                this.room.turnTimer?.clear();
                this.room.turnTimer = null;
                this.finishVoting();
            }
        }, 1000);
    }

    public vote(voterId: string, targetId: string): boolean {
        targetId = (+targetId).toString();

        if (this.room.state.gameStage !== GameStage.VOTING) {
            return false;
        }

        if (!this.isVotingActive) {
            return false;
        }

        const voter = this.room.state.players.get(voterId);
        if (!voter || voter.isEliminated) {
            return false;
        }

        // Проверяем, что игрок на месте и может голосовать
        let voterOnPlace = false;
        for (const [place, playerId] of this.room.state.places) {
            if (parseInt(place) < this.room.state.playersCount && playerId === voter.id) {
                voterOnPlace = true;
                break;
            }
        }

        if (!voterOnPlace) {
            return false;
        }

        // Проверяем воздержание
        if (targetId == "0") {
            if (!this.room.state.canAbstainThisRound) {
                return false; // Нельзя воздержаться в этом раунде
            }
            this.room.state.currentVotes.set(voterId, "0");
        } else {
            const target = this.room.state.players.get(targetId);
            if (!target || target.isEliminated) {
                return false;
            }

            // Проверяем, что цель на месте
            let targetOnPlace = false;
            for (const [place, playerId] of this.room.state.places) {
                if (parseInt(place) < this.room.state.playersCount && playerId === target.id) {
                    targetOnPlace = true;
                    break;
                }
            }

            if (!targetOnPlace) {
                return false;
            }

            this.room.state.currentVotes.set(voterId, targetId);
        }

        // Проверяем, проголосовали ли все
        this.checkAllVoted();
        return true;
    }

    private checkAllVoted() {
        if (!this.isVotingActive) {
            return;
        }

        const activePlayers = [];

        for (const [place, playerId] of this.room.state.places) {
            if (parseInt(place) < this.room.state.playersCount && playerId > 0) {
                const player = this.room.state.players.get(playerId.toString());
                if (player && !player.isEliminated) {
                    activePlayers.push(playerId.toString());
                }
            }
        }

        const votedPlayers = activePlayers.filter(playerId =>
            this.room.state.currentVotes.has(playerId)
        );

        if (votedPlayers.length === activePlayers.length) {
            // Все проголосовали, завершаем голосование досрочно
            if (this.room.turnTimer) {
                this.room.turnTimer.clear();
                this.room.turnTimer = null;
            }
            this.room.state.turnTimeRemaining = 3;
            this.room.turnTimer = this.room.clock.setInterval(() => {
                this.room.state.turnTimeRemaining--;

                if (this.room.state.turnTimeRemaining <= 0) {
                    this.room.turnTimer?.clear();
                    this.room.turnTimer = null;
                    this.finishVoting();
                }
            }, 1000);
        }
    }

    private finishVoting() {
        if (!this.isVotingActive) {
            return;
        }
        this.isVotingActive = false;

        if (this.room.turnTimer) {
            this.room.turnTimer.clear();
            this.room.turnTimer = null;
        }

        this.room.botManager.handleVotingFinished();

        this.room.state.gameStage = GameStage.RESULTS;
        this.room.state.turnTimeRemaining = 7; // 7 секунд на результаты

        // Подсчитываем голоса
        const voteCount: { [key: string]: number } = {};
        let totalVotes = 0;

        for (const [_, targetId] of this.room.state.currentVotes) {
            if (targetId !== "0") { // Не считаем воздержавшихся
                voteCount[targetId] = (voteCount[targetId] || 0) + 1;
                totalVotes++;
            }
        }

        // Обновляем votesAgainst у игроков
        for (const [targetId, votes] of Object.entries(voteCount)) {
            const player = this.room.state.players.get(targetId);
            if (player) {
                player.votesAgainst = votes;
            }
        }

        let eliminatedPlayerId: string | null = null;
        let eliminateType: "voting" | "controversialVoting" | "random" | null = null;

        if (totalVotes === 0) {
            // Никто не голосовал или все воздержались
            if (!this.room.state.canAbstainThisRound) {
                // Выбираем случайного игрока для исключения
                const candidates = [];
                for (const [place, playerId] of this.room.state.places) {
                    if (parseInt(place) < this.room.state.playersCount && playerId > 0) {
                        const player = this.room.state.players.get(playerId.toString());
                        if (player && !player.isEliminated) {
                            candidates.push(playerId.toString());
                        }
                    }
                }
                if (candidates.length > 0) {
                    eliminatedPlayerId = candidates[Math.floor(Math.random() * candidates.length)];
                    eliminateType = "random";
                }
            }
        } else {
            // Находим игроков с максимальным количеством голосов
            const maxVotes = Math.max(...Object.values(voteCount));
            const candidates = Object.keys(voteCount).filter(playerId => voteCount[playerId] === maxVotes);

            if (candidates.length === 1) {
                eliminatedPlayerId = candidates[0];
                eliminateType = "voting";
            } else if (candidates.length > 1) {
                // Несколько кандидатов с одинаковым количеством голосов
                if (this.room.state.canAbstainThisRound) {
                    // Можно воздержаться, никто не выбывает
                    eliminatedPlayerId = null;
                    eliminateType = null;
                } else {
                    // Нельзя воздержаться, выбираем случайного из кандидатов
                    eliminatedPlayerId = candidates[Math.floor(Math.random() * candidates.length)];
                    eliminateType = "controversialVoting";
                }
            }
        }

        this.room.broadcast("votingResults", {
            votes: voteCount,
            eliminatedPlayerId: eliminatedPlayerId,
            round: this.room.state.currentRound,
            eliminateType: eliminatedPlayerId ? eliminateType : null
        });

        this.processElimination(eliminatedPlayerId, eliminatedPlayerId !== null);

        this.room.turnTimer = this.room.clock.setInterval(() => {
            this.room.state.turnTimeRemaining--;

            if (this.room.state.turnTimeRemaining <= 0) {
                this.room.turnTimer?.clear();
                this.room.turnTimer = null;
                this.room.state.currentVotes.clear();
                this.continueGame();
            }
        }, 1000);
    }

    private continueGame() {
        // Подсчитываем оставшихся игроков
        const remainingPlayers = [];
        for (const [place, playerId] of this.room.state.places) {
            if (parseInt(place) < this.room.state.playersCount && playerId > 0) {
                const player = this.room.state.players.get(playerId.toString());
                if (player && !player.isEliminated) {
                    remainingPlayers.push(player);
                }
            }
        }

        if (remainingPlayers.length <= 2) {
            // Игра окончена
            this.endGame(remainingPlayers);
        } else {
            // Продолжаем игру
            this.room.state.currentRound = this.room.state.currentRound +1;
            this.room.state.canAbstainThisRound = this.room.state.currentRound <= this.room.state.maxAbstainRounds;
            this.startGame();
        }
    }

    private processElimination(eliminatedPlayerId: string | null, delayVoiceMute: boolean = false) {
        if (eliminatedPlayerId) {
            const eliminatedPlayer = this.room.state.players.get(eliminatedPlayerId);
            if (eliminatedPlayer) {
                eliminatedPlayer.isEliminated = true;
                this.room.state.eliminatedPlayers.push(eliminatedPlayerId);

                if (!eliminatedPlayer.isBot) {
                    if (delayVoiceMute) {
                        this.room.clock.setTimeout(() => {
                            this.room.voiceHandler.updateParticipantPermissions(eliminatedPlayerId, false);
                        }, 3000);
                    } else {
                        this.room.voiceHandler.updateParticipantPermissions(eliminatedPlayerId, false);
                    }
                }

                // Открываем все карты исключенного игрока
                for (const card of eliminatedPlayer.cards) {
                    const isAlreadyRevealed = eliminatedPlayer.revealedCards.some(revealed => revealed.id === card.id);
                    if (!isAlreadyRevealed) {
                        const revealedCard = new Card(
                            card.id,
                            card.name,
                            card.type,
                            card.active,
                            card.maleImageUrl,
                            card.femaleImageUrl,
                            card.customData,
                            card.value
                        );
                        revealedCard.isRevealed = true;
                        eliminatedPlayer.revealedCards.push(revealedCard);
                    }
                }
            }
        }
    }

    private endGame(winners: Player[]) {
        this.room.state.status = RoomStatus.FINISHED;

        this.room.botManager.handleGameFinished();

        const results = [];
        let place = 1;

        // Победители (топ-2)
        for (const winner of winners) {
            results.push({
                playerId: winner.id,
                place: place++,
                isWinner: true
            });
        }

        // Исключенные игроки (в обратном порядке исключения)
        const eliminatedIds = [...this.room.state.eliminatedPlayers].reverse();
        for (const eliminatedId of eliminatedIds) {
            results.push({
                playerId: parseInt(eliminatedId),
                place: place++,
                isWinner: false
            });
        }

        this.room.broadcast("gameFinished", { results });
        try {
            ApiService.sendEndGame(this.room.state.customId, results);
        }
        catch (e: any){}

        // Очистка данных игры
        for (const [playerId, player] of this.room.state.players) {
            player.cards.clear();
            player.revealedCards.clear();
            player.isEliminated = false;
            player.isReady = player.isBot;

            if(!player.isConnected){
                this.room.state.players.delete(playerId);
                for (const [place, placedPlayerId] of this.room.state.places) {
                    if(playerId == placedPlayerId.toString()){
                        this.room.state.places.set(place, 0);
                    }
                }
            }
        }

        this.room.state.eliminatedPlayers.clear();
        this.room.state.scenario = new (require("../schema/bunker/SimpleScenario").SimpleScenario)();

        this.room.voiceHandler.updateAllParticipantsPermissions();
        this.room.voiceHandler.broadcastVoiceStatus();

        this.room.state.turnTimeRemaining = 10;
        this.room.turnTimer = this.room.clock.setInterval(() => {
            this.room.state.turnTimeRemaining--;

            if (this.room.state.turnTimeRemaining <= 0) {
                this.room.turnTimer.clear();
                this.room.turnTimer = null;
                this.room.state.status = RoomStatus.WAITING;
            }
        }, 1000);
    }

    public cleanup() {
        if (this.cardRevealTimer) {
            this.cardRevealTimer.clear();
            this.cardRevealTimer = null;
        }
        if (this.room.turnTimer) {
            this.room.turnTimer.clear();
            this.room.turnTimer = null;
        }
    }
}
