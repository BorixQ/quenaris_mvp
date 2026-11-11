export const groupColors = ['#176b46', '#377fa5', '#b28325', '#8362a8', '#a15f52', '#437f79', '#768334', '#926d88', '#527498', '#a77a47', '#5b8870', '#677d99'];
export const groupColor = (id: number) => id < 0 ? '#777e86' : groupColors[id % groupColors.length];
