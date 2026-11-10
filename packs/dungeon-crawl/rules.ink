// Dungeon crawl rules, pack version 1.1 (Inkwright, original rules).
// A game INCLUDEs this through its generated _engine.ink. The story calls -> crawl -> and then reads crawl_result:
// "won" (the warlord in the last room fell), "left" (the crew turned back), "fallen" (nobody is standing).
// Rolls are 2d6 + a stat against 7 + the other side's guard: a hit takes 1 life, beating it by 3 or more takes 2.
// Everything here works on the game's party and the "foe" kind, so a game may change both in its own game.md.
// 1.1: a hero with ranged 1 spends an arrow a shot (-2 without one); a foe with venom 1 poisons whom it wounds (3 turns,
// -1 life a turn); a battle round and a room are each a turn; a shrine and a potion cure poison.

VAR crawl_rooms = 6
VAR crawl_result = ""
VAR depth = 0
VAR fled = false

// The whole expedition: room after room until the last one, unless the crew turns back or falls.
=== crawl ===
~ depth = 0
~ crawl_result = ""
- (next)
{ alive("party") == 0:
    ~ crawl_result = "fallen"
    ->->
}
{ crawl_result == "won":
    ->->
}
{ depth > 0:
    {t("火把还剩 {torches} 支,药水 {potions} 瓶,箭 {inv_count(arrow)} 支,金币 {gold}。", "{torches} torches left, {potions} potions, {inv_count(arrow)} arrows, {gold} gold.")}
}
+ [{t("往深处走", "Go deeper")}]
    -> enter_room ->
    -> next
+ {depth > 0} [{t("就此回头", "Turn back")}]
    ~ crawl_result = "left"
    ->->

// One room: light a torch, see what is there, deal with it.
=== enter_room ===
~ depth += 1
~ end_turn()
{ torches > 0:
    ~ torches -= 1
- else:
    ~ temp hurt = pick_one("party", "random")
    {t("没有火把了。{name_of(hurt)}在黑暗里摔了一跤。", "No torches left. {name_of(hurt)} falls in the dark.")}
    ~ hurt_hero(hurt, 1)
}
{ depth >= crawl_rooms:
    {t("最深处的大厅。深渊督军站了起来。", "The deepest hall. The pit warlord rises.")}
    ~ spawn("foe", "warlord")
    -> battle ->
    { fled:
        ~ crawl_result = "left"
    - else:
        { alive("party") > 0:
            ~ crawl_result = "won"
        }
    }
    ->->
}
~ temp r = table_roll("rooms")
~ temp what = table_id("rooms", r)
{t("第 {depth} 间:{table_text("rooms", r)}。", "Room {depth}: {table_text("rooms", r)}.")}
{ what:
- "monsters":
    -> meet ->
- "treasure":
    ~ temp found = roll("2d6") * depth
    ~ temp arrows = roll("1d6") - 3
    ~ gold += found
    {t("箱子里有 {found} 枚金币。", "The chest holds {found} gold.")}
    { arrows > 0:
        ~ give(arrow, arrows)
        {t("还有 {arrows} 支箭。", "And {arrows} arrows.")}
    }
- "trap":
    -> trap ->
- "shrine":
    ~ heal_all(1, 2)
    ~ rest_statuses()
    {t("祭坛前歇了一会儿,每个人都好了些,毒也解了。", "A rest at the shrine; everyone feels better, and any poison is gone.")}
- else:
    {t("什么也没有。", "Nothing here.")}
}
->->

// Monsters: from the shallow table in the first half of the dungeon, the deep one after.
=== meet ===
{ depth * 2 <= crawl_rooms:
    ~ temp shallow = spawn_from("shallow")
    {t("是{table_text("shallow", shallow)}!", "It is {table_text("shallow", shallow)}!")}
- else:
    ~ temp deep = spawn_from("deep")
    {t("是{table_text("deep", deep)}!", "It is {table_text("deep", deep)}!")}
}
-> battle ->
->->

// A fight: each round one hero strikes the weakest foe, then every foe strikes a random hero.
=== battle ===
~ fled = false
- (round)
{ alive("foe") == 0:
    {t("打完了。", "The fight is over.")}
    ->->
}
{ alive("party") == 0:
    ->->
}
~ temp target = pick_one("foe", "lowest:life")
<- hero_option(1, target)
<- hero_option(2, target)
<- hero_option(3, target)
<- hero_option(4, target)
+ {potions > 0} [{t("喝一瓶药水(伤得最重的人 +3)", "Drink a potion (the most wounded +3)")}]
    ~ potions -= 1
    ~ temp worst = pick_one("party", "lowest:life")
    ~ heal(worst, 3)
    ~ clear_status(worst, "poison")
    {t("{name_of(worst)}喝下了药水。", "{name_of(worst)} drinks a potion.")}
    ~ foes_act(1)
    ~ end_turn()
    -> round
+ [{t("逃出这间屋子", "Flee the room")}]
    {t("你们转身就跑,它们追着砍了一轮。", "You turn and run; they get one more round of blows.")}
    ~ foes_act(1)
    ~ clear_foes()
    ~ fled = true
    ->->

// The k-th standing hero's attack, offered as a choice (nothing when there are fewer heroes standing).
=== hero_option(k, target) ===
~ temp who = nth_one("party", k)
{ who == "":
    -> DONE
}
+ [{t("{name_of(who)}攻击{name_of(target)}", "{name_of(who)} attacks {name_of(target)}")}]
    ~ strike(who, target)
    ~ foes_act(1)
    ~ end_turn()
    -> battle.round
- -> DONE

// A hero against a foe: 2d6 + might against 7 + the foe's guard. A ranged hero shoots an arrow, or fights at -2 without one.
=== function strike(who, target) ===
~ temp foe_name = name_of(target)
~ temp margin = roll("2d6") + stat(who, "might") - 7 - stat(target, "guard")
{ stat(who, "ranged") > 0:
    { take(arrow, 1) == 0:
        ~ margin -= 2
        {t("{name_of(who)}没有箭了,只能拔刀。", "{name_of(who)} is out of arrows and draws a knife.")}
    }
}
{
- margin >= 3:
    ~ add_stat(target, "life", -2)
    {t("{name_of(who)}重重一击,{foe_name}掉了 2 点生命。", "{name_of(who)} lands a heavy blow: {foe_name} loses 2.")}
- margin >= 0:
    ~ add_stat(target, "life", -1)
    {t("{name_of(who)}打中了{foe_name}。", "{name_of(who)} hits {foe_name}.")}
- else:
    {t("{name_of(who)}没打中。", "{name_of(who)} misses.")}
}

// The k-th foe and the ones after it each strike a random standing hero: 2d6 + attack against 7 + the hero's guard.
=== function foes_act(k) ===
{ k > alive("foe") || alive("party") == 0:
    ~ return
}
~ temp attacker = nth_one("foe", k)
~ temp victim = pick_one("party", "random")
~ temp margin = roll("2d6") + stat(attacker, "attack") - 7 - stat(victim, "guard")
{
- margin >= 3:
    {t("{name_of(attacker)}重创了{name_of(victim)}。", "{name_of(attacker)} badly wounds {name_of(victim)}.")}
    ~ hurt_hero(victim, 2)
    ~ venom(attacker, victim)
- margin >= 0:
    {t("{name_of(attacker)}伤了{name_of(victim)}。", "{name_of(attacker)} wounds {name_of(victim)}.")}
    ~ hurt_hero(victim, 1)
    ~ venom(attacker, victim)
- else:
    {t("{name_of(victim)}挡住了{name_of(attacker)}。", "{name_of(victim)} fends off {name_of(attacker)}.")}
}
~ foes_act(k + 1)

// A loose flagstone: a random hero rolls 2d6 + might, 8 or more to jump clear.
=== trap ===
~ temp who = pick_one("party", "random")
{ roll("2d6") + stat(who, "might") >= 8:
    {t("{name_of(who)}及时跳开了。", "{name_of(who)} jumps clear.")}
- else:
    {t("{name_of(who)}掉进了坑里,伤得不轻。", "{name_of(who)} falls into the pit and is badly hurt.")}
    ~ hurt_hero(who, 2)
}
->->

// A venomous foe's wound poisons a hero still standing (3 turns; again = 3 more from now).
=== function venom(attacker, victim) ===
{ stat(attacker, "venom") > 0 && stat(victim, "life") > 0:
    { not has_status(victim, "poison"):
        {t("{name_of(victim)}中毒了。", "{name_of(victim)} is poisoned.")}
    }
    ~ add_status(victim, "poison", 3)
}

// A turn passes (a battle round, a room): poison bites the standing heroes, then statuses count down.
=== function end_turn() ===
~ poison_bites(1)
~ tick_statuses()

=== function poison_bites(k) ===
~ temp who = nth_one("party", k)
{ who != "":
    { has_status(who, "poison"):
        {t("毒在{name_of(who)}身上发作。", "Poison burns in {name_of(who)}.")}
        ~ hurt_hero(who, 1)
        // Down: the next standing hero is now k-th.
        { stat(who, "life") <= 0:
            ~ clear_status(who, "")
            ~ poison_bites(k)
            ~ return
        }
    }
    ~ poison_bites(k + 1)
}

=== function hurt_hero(who, n) ===
~ add_stat(who, "life", 0 - n)
{ stat(who, "life") <= 0:
    {t("{name_of(who)}倒下了。", "{name_of(who)} goes down.")}
}

=== function heal(who, n) ===
~ set_stat(who, "life", MIN(stat(who, "life") + n, stat(who, "life_max")))

// Heals the k-th standing hero and the ones after.
=== function heal_all(k, n) ===
~ temp who = nth_one("party", k)
{ who != "":
    ~ heal(who, n)
    ~ heal_all(k + 1, n)
}

=== function clear_foes() ===
{ alive("foe") > 0:
    ~ despawn(nth_one("foe", 1))
    ~ clear_foes()
}
