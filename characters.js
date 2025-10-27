// characters.js
export const characters = {
  coins: parseInt(localStorage.getItem("bananasCollected") || "0", 10), // bananas act as coins
  selected: localStorage.getItem("selectedCharacter") || "Orangutan",
  list: [
    {
      name: "Orangutan",
      cost: 0,
      unlocked: true,
      modelPath: "./Orangutan.glb",
      scale: 1.2,
      description: "The original parkour champ!",
      stats: {
        speed: 5,      // moderate
        jump: 6,       // decent jump
        power: 5,      // balanced
        stamina: 7     // can last longer
      }
    },
    {
      name: "lil Man",
      cost: 50,
      unlocked: false,
      modelPath: "./man.glb",
      scale: 1.2,
      description: "Small but quick!",
      stats: {
        speed: 8,      // faster
        jump: 7,       // agile jumper
        power: 3,      // weak push
        stamina: 4     // tires quickly
      }
    },
    {
      name: "Mousy",
      cost: 350,
      unlocked: false,
      modelPath: "./mousy.glb",
      scale: 1.0,
      description: "Laosy da Mousy",
      stats: {
        speed: 9,      // very quick
        jump: 8,       // super jumper
        power: 2,      // light but nimble
        stamina: 3     // low endurance
      }
    }
  ]
};

// Load unlocked characters and selected character from localStorage
export function loadCharacterProgress() {
  const unlockedChars = JSON.parse(localStorage.getItem("unlockedChars") || "[]");
  const selected = localStorage.getItem("selectedCharacter") || "Orangutan";
  characters.selected = selected;

  characters.list.forEach((char) => {
    if (char.cost === 0 || unlockedChars.includes(char.name)) {
      char.unlocked = true;
    }
  });

  characters.coins = parseInt(localStorage.getItem("bananasCollected") || "0", 10);
  return { unlockedChars, selected };
}

// Save updates after buying or switching
export function saveCharacterProgress(unlockedChars) {
  localStorage.setItem("unlockedChars", JSON.stringify(unlockedChars));
  localStorage.setItem("selectedCharacter", characters.selected);
  localStorage.setItem("bananasCollected", characters.coins.toString());
}
