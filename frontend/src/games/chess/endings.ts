/** How a game ended, in words (server `ending` / chess.js checks). */
export const ENDING_TEXT: Record<string, string> = {
  checkmate: "Checkmate!",
  stalemate: "Stalemate: no legal move, but not in check. It's a draw.",
  repetition: "Draw by repetition (the same position three times).",
  fifty_moves: "Draw by the 50-move rule.",
  insufficient_material: "Draw: nobody has enough pieces left to checkmate.",
  resign: "Resigned.",
  agreement: "Draw agreed.",
};
