const favoriteFruits: string[] = ['apple', 'strawberry', 'orange']

function addFruit(fruit: string): string[] {
  favoriteFruits.push(fruit)

  return favoriteFruits
}
