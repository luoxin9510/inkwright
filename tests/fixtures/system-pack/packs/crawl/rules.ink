// The pack's procedure: fight whatever is in the room until it is gone or the hero is down.
=== fight ===
{ alive("foe") == 0: ->-> }
{ hp <= 0: ->-> }
~ temp t = pick_one("foe", "lowest:life")
~ add_stat(t, "life", -1)
~ hp -= stat(t, "bite")
-> fight
