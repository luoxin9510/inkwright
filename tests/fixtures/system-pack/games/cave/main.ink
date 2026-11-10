INCLUDE _engine.ink
~ temp r = spawn_from("lair")
In the cave: {table_text("lair", r)}.
-> fight ->
{ hp > 0:
    Won with {hp} left.
- else:
    Lost.
}
-> END
