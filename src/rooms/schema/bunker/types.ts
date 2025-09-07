export type TUser = {
    id: number;
    name: string;
    isMale: boolean;
    experience: number;
    level: number;
    popularity: number;
    popularityLevel: number;
    isVip: boolean;
    isPremium: boolean;
    avatar: string
}

export type TEcosystemResponse<T> = {
    success: boolean;
    data: T;
    message: string;
}
export type TCard = {
    id: number,
    name: string,
    type: string,
    active: boolean,
    male_image_url: string | null,
    female_image_url: string | null,
    custom_data: null | {
        from?: number,
        to?: number
    }
}
export type TScenarioResponse = {
    id: number,
    name: string,
    description: string,
    imageUrl: string,
    smallImageUrl: string,
    cardsProfession: TCard[] | null,
    cardsSkills: TCard[] | null,
    cardsLuggage: TCard[] | null,
    cardsHealth: TCard[] | null,
    cardsCharacteristic: TCard[] | null,
    cardsAge: TCard[] | null,
    cardsAdditionalInformation: TCard[] | null,
    cardsPhobias: TCard[] | null,

}